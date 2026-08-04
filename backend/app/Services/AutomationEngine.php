<?php

namespace App\Services;

use App\Events\AutomationFired;
use App\Jobs\DelayedDeviceAction;
use App\Models\Automation;
use App\Models\Device;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * AutomationEngine – prüft Auslöser und führt Aktionen aus.
 *
 * Wird aufgerufen:
 *   - aus MqttSubscribe nach jedem Gerätestatus-Update (Geräte-Trigger)
 *   - aus dem Scheduler jede Minute (Zeit- + Dauertrigger)
 */
class AutomationEngine
{
    public function __construct(private readonly DeviceService $deviceService) {}

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
            if ($this->deviceTriggerFires($automation->trigger, $device, $previousStatus)) {
                Log::info("[AutomationEngine] Automation '{$automation->name}' ausgelöst (Gerät: {$device->name})");
                $this->executeAction($automation->action, $automation->name);
            }
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
                $attrs['on_duration_fired'] = true;
                $device->update(['attributes' => $attrs]);
                Log::info("[AutomationEngine] Dauertrigger '{$automation->name}': {$device->name} seit {$elapsed} Min. an");
                $this->executeAction($automation->action, $automation->name);
            }
        }
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
        ];
        if (in_array($type, $deviceTriggers) && $deviceId && $deviceId !== $device->id) {
            return false;
        }

        return match ($type) {
            // Gerät ein-/ausgeschaltet (nur bei Zustandswechsel)
            'device_status' =>
                $device->status === ($trigger['status'] ?? '')
                && $previousStatus !== ($trigger['status'] ?? ''),

            // Temperatursensor
            'temperature_above' =>
                isset($device->attributes['temperature'])
                && (float) $device->attributes['temperature'] > (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:temp_above"),

            'temperature_below' =>
                isset($device->attributes['temperature'])
                && (float) $device->attributes['temperature'] < (float) ($trigger['threshold'] ?? 0)
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
                Device::where('room_id', $action['room_id'] ?? null)
                    ->where('active', true)
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

            case 'notify':
                // Placeholder – später: Push-Benachrichtigung / WebSocket-Event
                Log::info('[Automation] Benachrichtigung: ' . ($action['message'] ?? ''));
                break;
        }

        if ($automationName) {
            AutomationFired::dispatch($automationName, $summary);
        }
    }

    /** Erzeugt eine lesbare Aktionsbeschreibung für die Frontend-Benachrichtigung. */
    private function describeAction(array $action): string
    {
        $type = $action['type'] ?? '';

        $deviceName = fn () => optional(Device::find($action['device_id'] ?? null))->name ?? 'Gerät';

        return match ($type) {
            'set_device_status' => sprintf(
                '„%s" %s',
                $deviceName(),
                ($action['status'] ?? '') === 'on' ? 'eingeschaltet' : 'ausgeschaltet'
            ),
            'toggle_device'     => sprintf('„%s" umgeschaltet', $deviceName()),
            'set_room_devices'  => sprintf(
                'Raum %s: alle Geräte %s',
                $action['room_id'] ?? '?',
                ($action['status'] ?? '') === 'on' ? 'an' : 'aus'
            ),
            'delayed_off'       => sprintf('„%s" in %d Min. aus', $deviceName(), (int) ($action['minutes'] ?? 0)),
            'delayed_on'        => sprintf('„%s" in %d Min. an', $deviceName(), (int) ($action['minutes'] ?? 0)),
            'notify'            => (string) ($action['message'] ?? ''),
            default             => $type,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hilfsmethoden
    // ─────────────────────────────────────────────────────────────────────────

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
