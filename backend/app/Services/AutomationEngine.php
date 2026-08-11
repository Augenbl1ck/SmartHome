<?php

namespace App\Services;

use App\Services\PushNotificationService;
use App\Events\AutomationFired;
use App\Jobs\DelayedDeviceAction;
use App\Models\Automation;
use App\Models\AutomationLog;
use App\Models\Device;
use App\Models\Scene;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * AutomationEngine – prüft Auslöser, optionale AND/OR-Bedingungen und führt Aktionen aus.
 *
 * Wird aufgerufen:
 *   - aus MqttSubscribe nach jedem Gerätestatus-Update (Geräte-Trigger)
 *   - aus dem Scheduler jede Minute (Zeit- + Dauertrigger)
 */
class AutomationEngine
{
    public function __construct(
        private readonly DeviceService $deviceService,
        private readonly SceneService $sceneService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Einstiegspunkte
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wird nach jedem Geräteupdate aus MqttSubscribe aufgerufen.
     */
    public function onDeviceUpdated(Device $device, string $previousStatus): void
    {
        $this->trackOnSince($device, $previousStatus);

        foreach (Automation::where('enabled', true)->get() as $automation) {
            if (!$this->deviceTriggerFires($automation->trigger, $device, $previousStatus)) {
                continue;
            }
            if (!$this->conditionsPass($automation->conditions)) {
                continue;
            }
            Log::info("[AutomationEngine] Automation '{$automation->name}' ausgelöst (Gerät: {$device->name})");
            $this->executeAction($automation->action, $automation->name);
        }
    }

    /**
     * Zeitbasierte Trigger – jede Minute vom Scheduler aufgerufen.
     */
    public function runTimeTriggers(): void
    {
        $time    = now()->format('H:i');
        $weekday = (int) now()->format('w'); // 0 = Sonntag

        foreach (Automation::where('enabled', true)->get() as $automation) {
            $trigger = $automation->trigger;
            $type    = $trigger['type'] ?? '';

            if ($type === 'time' && ($trigger['time'] ?? '') === $time) {
                $cacheKey = "automation:{$automation->id}:fired:{$time}";
                if (Cache::has($cacheKey)) {
                    continue;
                }
                if (!$this->conditionsPass($automation->conditions)) {
                    continue;
                }
                Cache::put($cacheKey, true, now()->addMinutes(1));
                Log::info("[AutomationEngine] Zeit-Automation '{$automation->name}' um {$time}");
                $this->executeAction($automation->action, $automation->name);
            }

            if ($type === 'weekday_time'
                && ($trigger['time'] ?? '') === $time
                && in_array($weekday, $trigger['weekdays'] ?? [])
            ) {
                $cacheKey = "automation:{$automation->id}:fired:{$time}:{$weekday}";
                if (Cache::has($cacheKey)) {
                    continue;
                }
                if (!$this->conditionsPass($automation->conditions)) {
                    continue;
                }
                Cache::put($cacheKey, true, now()->addMinutes(1));
                Log::info("[AutomationEngine] Wochentag-Automation '{$automation->name}' um {$time}");
                $this->executeAction($automation->action, $automation->name);
            }
        }
    }

    /**
     * Prüft "Gerät ist zu lange eingeschaltet"-Trigger – jede Minute.
     */
    public function checkOnDurationTriggers(): void
    {
        $automations = Automation::where('enabled', true)->get()->filter(
            fn ($a) => ($a->trigger['type'] ?? '') === 'device_on_duration'
        );

        foreach ($automations as $automation) {
            $trigger  = $automation->trigger;
            $deviceId = (int) ($trigger['device_id'] ?? 0);
            $minutes  = (int) ($trigger['minutes'] ?? 30);

            if (!$deviceId) {
                continue;
            }

            $device = Device::find($deviceId);
            if (!$device || $device->status !== 'on') {
                continue;
            }

            $attrs   = $device->attributes ?? [];
            $onSince = $attrs['on_since'] ?? null;
            if (!$onSince) {
                continue;
            }

            if ($attrs['on_duration_fired'] ?? false) {
                continue; // schon ausgelöst, wird bei nächstem Ausschalten zurückgesetzt
            }

            $elapsed = (int) now()->diffInMinutes($onSince);
            if ($elapsed >= $minutes) {
                if (!$this->conditionsPass($automation->conditions)) {
                    continue;
                }
                $attrs['on_duration_fired'] = true;
                $device->update(['attributes' => $attrs]);
                Log::info("[AutomationEngine] Dauertrigger '{$automation->name}': {$device->name} seit {$elapsed} Min. an");
                $this->executeAction($automation->action, $automation->name);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bedingungen (AND/OR) – Zustandsprüfungen, keine Edge-Trigger
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param  array<string, mixed>|null  $conditions
     */
    public function conditionsPass(?array $conditions): bool
    {
        if (!$conditions || empty($conditions['items']) || !is_array($conditions['items'])) {
            return true;
        }

        $logic = strtolower((string) ($conditions['logic'] ?? 'and'));
        $items = $conditions['items'];

        if ($logic === 'or') {
            foreach ($items as $item) {
                if (is_array($item) && $this->evaluateCondition($item)) {
                    return true;
                }
            }
            return false;
        }

        // Default: AND
        foreach ($items as $item) {
            if (!is_array($item) || !$this->evaluateCondition($item)) {
                return false;
            }
        }
        return true;
    }

    private function evaluateCondition(array $condition): bool
    {
        $type = $condition['type'] ?? '';

        return match ($type) {
            'device_status' => $this->conditionDeviceStatus($condition),
            'temperature_above', 'temperature_below' => $this->conditionTemperature($condition, $type === 'temperature_above'),
            'humidity_above', 'humidity_below' => $this->conditionHumidity($condition, $type === 'humidity_above'),
            'door_open' => $this->conditionDeviceEquals($condition, 'open'),
            'door_closed' => $this->conditionDeviceEquals($condition, 'closed'),
            'motion' => $this->conditionDeviceEquals($condition, 'on'),
            'time_between' => $this->conditionTimeBetween($condition),
            'weekday' => $this->conditionWeekday($condition),
            default => false,
        };
    }

    private function conditionDeviceStatus(array $condition): bool
    {
        $device = Device::find($condition['device_id'] ?? null);
        if (!$device) {
            return false;
        }
        return $device->status === ($condition['status'] ?? '');
    }

    private function conditionDeviceEquals(array $condition, string $status): bool
    {
        $device = Device::find($condition['device_id'] ?? null);
        return $device && $device->status === $status;
    }

    private function conditionTemperature(array $condition, bool $above): bool
    {
        $device = Device::find($condition['device_id'] ?? null);
        if (!$device) {
            return false;
        }
        $temp = $this->resolveTemperature($device);
        if ($temp === null) {
            return false;
        }
        $threshold = (float) ($condition['threshold'] ?? 0);
        return $above ? $temp > $threshold : $temp < $threshold;
    }

    private function conditionHumidity(array $condition, bool $above): bool
    {
        $device = Device::find($condition['device_id'] ?? null);
        if (!$device || !isset($device->attributes['humidity'])) {
            return false;
        }
        $value = (float) $device->attributes['humidity'];
        $threshold = (float) ($condition['threshold'] ?? 0);
        return $above ? $value > $threshold : $value < $threshold;
    }

    private function conditionTimeBetween(array $condition): bool
    {
        $from = (string) ($condition['from'] ?? '');
        $to   = (string) ($condition['to'] ?? '');
        if ($from === '' || $to === '') {
            return false;
        }

        $now = now()->format('H:i');

        // Über Mitternacht: z.B. 22:00–06:00
        if ($from > $to) {
            return $now >= $from || $now <= $to;
        }

        return $now >= $from && $now <= $to;
    }

    private function conditionWeekday(array $condition): bool
    {
        $weekdays = $condition['weekdays'] ?? [];
        if (!is_array($weekdays) || $weekdays === []) {
            return false;
        }
        $weekday = (int) now()->format('w');
        return in_array($weekday, $weekdays, true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Trigger-Prüfung
    // ─────────────────────────────────────────────────────────────────────────

    private function deviceTriggerFires(array $trigger, Device $device, string $previousStatus): bool
    {
        $type     = $trigger['type'] ?? '';
        $deviceId = (int) ($trigger['device_id'] ?? 0);

        // Gerätespezifische Trigger: Gerät muss übereinstimmen
        $deviceTriggers = [
            'device_status', 'temperature_above', 'temperature_below',
            'humidity_above', 'humidity_below', 'motion', 'door_open', 'door_closed',
            'flood', 'smoke', 'battery_low', 'power_above',
        ];
        if (in_array($type, $deviceTriggers) && $deviceId && $deviceId !== $device->id) {
            return false;
        }

        $temperature = $this->resolveTemperature($device);

        return match ($type) {
            // Gerät ein-/ausgeschaltet (nur bei Zustandswechsel)
            'device_status' =>
                $device->status === ($trigger['status'] ?? '')
                && $previousStatus !== ($trigger['status'] ?? ''),

            // Temperatur (Sensor oder Thermostat local_temperature)
            'temperature_above' =>
                $temperature !== null
                && $temperature > (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:temp_above"),

            'temperature_below' =>
                $temperature !== null
                && $temperature < (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:temp_below"),

            // Luftfeuchtigkeit
            'humidity_above' =>
                isset($device->attributes['humidity'])
                && (float) $device->attributes['humidity'] > (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:hum_above"),

            'humidity_below' =>
                isset($device->attributes['humidity'])
                && (float) $device->attributes['humidity'] < (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:hum_below"),

            // Bewegungsmelder (nur beim Einschalten)
            'motion' =>
                $device->status === 'on' && $previousStatus !== 'on',

            // Tür-/Fensterkontakt
            'door_open'   => $device->status === 'open'   && $previousStatus !== 'open',
            'door_closed' => $device->status === 'closed' && $previousStatus !== 'closed',

            // Wasser- / Rauchsensor
            'flood' => $device->status === 'on' && $previousStatus !== 'on',
            'smoke' => $device->status === 'on' && $previousStatus !== 'on',

            // Batterie niedrig
            'battery_low' =>
                isset($device->attributes['battery'])
                && (float) $device->attributes['battery'] < (float) ($trigger['threshold'] ?? 20)
                && $this->notOnCooldown("auto:{$deviceId}:battery_low"),

            // Leistungsaufnahme zu hoch
            'power_above' =>
                isset($device->attributes['power_w'])
                && (float) $device->attributes['power_w'] > (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:power_above"),

            default => false,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Aktionsausführung
    // ─────────────────────────────────────────────────────────────────────────

    private function executeAction(array $action, string $automationName = ''): void
    {
        $type    = $action['type'] ?? '';
        $summary = $this->describeAction($action);

        switch ($type) {
            case 'set_device_status':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    $this->deviceService->setStatus($device, $action['status'] ?? 'off');
                }
                break;

            case 'toggle_device':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    $this->deviceService->setStatus($device, $device->status === 'on' ? 'off' : 'on');
                }
                break;

            case 'set_room_devices':
                // Thermostate bewusst auslassen (Mode/Sollwert nicht per on/off)
                Device::where('room_id', $action['room_id'] ?? null)
                    ->where('active', true)
                    ->where('type', '!=', 'thermostat')
                    ->get()
                    ->each(fn ($d) => $this->deviceService->setStatus($d, $action['status'] ?? 'off'));
                break;

            case 'delayed_off':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    DelayedDeviceAction::dispatch($device->id, 'off')
                        ->delay(now()->addMinutes((int) ($action['minutes'] ?? 10)));
                }
                break;

            case 'delayed_on':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    DelayedDeviceAction::dispatch($device->id, 'on')
                        ->delay(now()->addMinutes((int) ($action['minutes'] ?? 10)));
                }
                break;

            case 'set_thermostat_setpoint':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $setpoint = round((float) ($action['setpoint'] ?? 21), 1);
                    $setpoint = max(4.0, min(35.0, $setpoint));
                    $this->deviceService->setStatus($device, (string) $setpoint);
                }
                break;

            case 'set_thermostat_mode':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $mode = strtolower((string) ($action['mode'] ?? 'heat'));
                    if (in_array($mode, ['off', 'auto', 'heat'], true)) {
                        $this->deviceService->setStatus($device, $mode);
                    }
                }
                break;

            case 'activate_scene':
                $scene = Scene::find($action['scene_id'] ?? null);
                if ($scene) {
                    $this->sceneService->activate($scene);
                }
                break;

            case 'notify':
                $message = $action['message'] ?? 'Automation ausgelöst';
                app(PushNotificationService::class)->send(
                    $automationName ?? 'SmartHome',
                    $message,
                );
                Log::info('[Automation] Push gesendet: ' . $message);
                break;
        }

        if ($automationName) {
            AutomationLog::create([
                'automation_name' => $automationName,
                'action_summary'  => $summary,
                'fired_at'        => now(),
            ]);
            AutomationFired::dispatch($automationName, $summary);
        }
    }

    /** Erzeugt eine lesbare Aktionsbeschreibung für die Frontend-Benachrichtigung. */
    private function describeAction(array $action): string
    {
        $type = $action['type'] ?? '';

        $deviceName = fn () => optional(Device::find($action['device_id'] ?? null))->name ?? 'Gerät';

        $statusLabel = function () use ($action): string {
            $status = (string) ($action['status'] ?? '');
            return match ($status) {
                'on'    => 'eingeschaltet',
                'off'   => 'ausgeschaltet',
                'open'  => 'geöffnet',
                'close' => 'geschlossen',
                'stop'  => 'gestoppt',
                default => $status !== '' ? $status : 'gesetzt',
            };
        };

        return match ($type) {
            'set_device_status' => sprintf('„%s" %s', $deviceName(), $statusLabel()),
            'toggle_device'     => sprintf('„%s" umgeschaltet', $deviceName()),
            'set_room_devices'  => sprintf(
                'Raum %s: alle Geräte %s',
                $action['room_id'] ?? '?',
                ($action['status'] ?? '') === 'on' ? 'an' : 'aus'
            ),
            'delayed_off'              => sprintf('„%s" in %d Min. aus', $deviceName(), (int) ($action['minutes'] ?? 0)),
            'delayed_on'               => sprintf('„%s" in %d Min. an', $deviceName(), (int) ($action['minutes'] ?? 0)),
            'set_thermostat_setpoint'  => sprintf('„%s" Sollwert %s°C', $deviceName(), $action['setpoint'] ?? '?'),
            'set_thermostat_mode'      => sprintf(
                '„%s" Modus %s',
                $deviceName(),
                match ((string) ($action['mode'] ?? '')) {
                    'heat' => 'Heizen',
                    'off'  => 'Aus',
                    'auto' => 'Auto',
                    default => (string) ($action['mode'] ?? '?'),
                }
            ),
            'activate_scene' => sprintf(
                'Szene „%s" aktiviert',
                optional(Scene::find($action['scene_id'] ?? null))->name ?? '?'
            ),
            'notify'            => (string) ($action['message'] ?? ''),
            default             => $type,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hilfsmethoden
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Temperatur aus Sensor- oder Thermostat-Attributen lesen.
     * Priorität: local_temperature → temperature → numerischer status
     */
    private function resolveTemperature(Device $device): ?float
    {
        $attrs = $device->attributes ?? [];

        if (isset($attrs['local_temperature']) && is_numeric($attrs['local_temperature'])) {
            return (float) $attrs['local_temperature'];
        }

        if (isset($attrs['temperature']) && is_numeric($attrs['temperature'])) {
            return (float) $attrs['temperature'];
        }

        if (is_numeric($device->status)) {
            return (float) $device->status;
        }

        return null;
    }

    /** Speichert on_since beim Einschalten, entfernt es beim Ausschalten. */
    private function trackOnSince(Device $device, string $previousStatus): void
    {
        $attrs = $device->attributes ?? [];

        if ($device->status === 'on' && $previousStatus !== 'on') {
            $attrs['on_since'] = now()->toIso8601String();
            unset($attrs['on_duration_fired']);
            $device->update(['attributes' => $attrs]);
        } elseif ($device->status !== 'on' && $previousStatus === 'on') {
            unset($attrs['on_since'], $attrs['on_duration_fired']);
            $device->update(['attributes' => $attrs]);
        }
    }

    /** Prüft Cooldown für Sensor-Trigger (verhindert Dauerfeuern). 5-Minuten-Sperre. */
    private function notOnCooldown(string $key): bool
    {
        if (Cache::has($key)) {
            return false;
        }
        Cache::put($key, true, now()->addMinutes(5));
        return true;
    }
}
