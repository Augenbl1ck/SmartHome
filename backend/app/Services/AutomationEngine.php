<?php

namespace App\Services;

use App\Events\AutomationFired;
use App\Models\Automation;
use App\Models\AutomationLog;
use App\Models\Device;
use App\Models\Scene;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * AutomationEngine – Conditions (AND/OR) + Legacy-Trigger, Aktionen.
 *
 * Conditions-Automationen: Auswertung bei Geräte-Update und jede Minute (Rising Edge).
 * Legacy: klassische Trigger + optionale Conditions.
 */
class AutomationEngine
{
    public function __construct(
        private readonly ActionExecutor $actionExecutor,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Einstiegspunkte
    // ─────────────────────────────────────────────────────────────────────────

    public function onDeviceUpdated(Device $device, string $previousStatus): void
    {
        $this->trackOnSince($device, $previousStatus);

        // Neue Conditions-only Automationen
        $this->evaluateConditionsAutomations();

        // Legacy-Trigger (nicht type=conditions / interlock)
        foreach (Automation::where('enabled', true)->get() as $automation) {
            if ($this->isConditionsOnly($automation) || $this->isInterlock($automation)) {
                continue;
            }
            if (!$this->deviceTriggerFires($automation->trigger ?? [], $device, $previousStatus)) {
                continue;
            }
            if (!$this->conditionsPass($automation->conditions)) {
                continue;
            }
            Log::info("[AutomationEngine] Automation '{$automation->name}' ausgelöst (Gerät: {$device->name})");
            $this->executeAction($automation->action, $automation->name);
        }
    }

    public function runTimeTriggers(): void
    {
        // Conditions-only jede Minute
        $this->evaluateConditionsAutomations();

        $time    = now()->format('H:i');
        $weekday = (int) now()->format('w');

        foreach (Automation::where('enabled', true)->get() as $automation) {
            if ($this->isConditionsOnly($automation) || $this->isInterlock($automation)) {
                continue;
            }

            $trigger = $automation->trigger ?? [];
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
                && in_array($weekday, $trigger['weekdays'] ?? [], true)
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
                continue;
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

    /**
     * Conditions-only: Rising Edge wenn Bedingungen wahr werden.
     */
    public function evaluateConditionsAutomations(): void
    {
        foreach (Automation::where('enabled', true)->get() as $automation) {
            if (!$this->isConditionsOnly($automation) || !$this->hasConditionItems($automation)) {
                continue;
            }

            $cacheKey = "automation:{$automation->id}:cond_met";
            $pass     = $this->conditionsPass($automation->conditions);

            if (!$pass) {
                Cache::forget($cacheKey);
                continue;
            }

            if (Cache::has($cacheKey)) {
                continue;
            }

            Cache::put($cacheKey, true, now()->addDays(7));
            Log::info("[AutomationEngine] Conditions-Automation '{$automation->name}' ausgelöst");
            $this->executeAction($automation->action, $automation->name);
        }
    }

    private function isConditionsOnly(Automation $automation): bool
    {
        return ($automation->trigger['type'] ?? '') === 'conditions';
    }

    private function isInterlock(Automation $automation): bool
    {
        return ($automation->trigger['type'] ?? '') === 'interlock';
    }

    private function hasConditionItems(Automation $automation): bool
    {
        $items = $automation->conditions['items'] ?? null;
        return is_array($items) && count($items) > 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bedingungen (AND/OR)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param  array<string, mixed>|null  $conditions
     */
    public function conditionsPass(?array $conditions): bool
    {
        if (!$conditions || empty($conditions['items']) || !is_array($conditions['items'])) {
            return true; // Legacy: keine Conditions = ok
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
            'time_at' => $this->conditionTimeAt($condition),
            'sunrise' => $this->conditionSunEvent('sunrise', $condition),
            'sunset' => $this->conditionSunEvent('sunset', $condition),
            'weekday' => $this->conditionWeekday($condition),
            'child_lock' => $this->conditionAttrEquals($condition, 'child_lock', strtoupper((string) ($condition['value'] ?? 'LOCK'))),
            'open_window' => $this->conditionAttrEquals($condition, 'open_window', strtoupper((string) ($condition['value'] ?? 'ON'))),
            'running_state' => $this->conditionAttrEquals($condition, 'running_state', strtolower((string) ($condition['value'] ?? 'heat'))),
            default => false,
        };
    }

    private function conditionSunEvent(string $event, array $condition): bool
    {
        $offset = (int) ($condition['offset_minutes'] ?? 0);
        if ($offset < -120) {
            $offset = -120;
        }
        if ($offset > 120) {
            $offset = 120;
        }

        return app(SunTimesService::class)->matchesNow($event, $offset);
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

    private function conditionAttrEquals(array $condition, string $attr, string $expected): bool
    {
        $device = Device::find($condition['device_id'] ?? null);
        if (!$device) {
            return false;
        }
        $actual = $device->attributes[$attr] ?? null;
        if ($actual === null) {
            return false;
        }
        return strtoupper((string) $actual) === strtoupper($expected)
            || strtolower((string) $actual) === strtolower($expected);
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

        $fromDate = (string) ($condition['from_date'] ?? '');
        $toDate   = (string) ($condition['to_date'] ?? '');

        if ($fromDate !== '' && $toDate !== '') {
            try {
                $start = \Carbon\Carbon::createFromFormat('Y-m-d H:i', $fromDate . ' ' . $from);
                $end   = \Carbon\Carbon::createFromFormat('Y-m-d H:i', $toDate . ' ' . $to);
            } catch (\Throwable) {
                return false;
            }
            if (!$start || !$end) {
                return false;
            }
            $now = now();
            return $now->gte($start) && $now->lte($end);
        }

        $now = now()->format('H:i');

        if ($from > $to) {
            return $now >= $from || $now <= $to;
        }

        return $now >= $from && $now <= $to;
    }

    private function conditionTimeAt(array $condition): bool
    {
        $time = (string) ($condition['time'] ?? '');
        if ($time === '') {
            return false;
        }
        return now()->format('H:i') === $time;
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
    // Trigger-Prüfung (Legacy)
    // ─────────────────────────────────────────────────────────────────────────

    private function deviceTriggerFires(array $trigger, Device $device, string $previousStatus): bool
    {
        $type     = $trigger['type'] ?? '';
        $deviceId = (int) ($trigger['device_id'] ?? 0);

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
            'device_status' =>
                $device->status === ($trigger['status'] ?? '')
                && $previousStatus !== ($trigger['status'] ?? ''),

            'temperature_above' =>
                $temperature !== null
                && $temperature > (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:temp_above"),

            'temperature_below' =>
                $temperature !== null
                && $temperature < (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:temp_below"),

            'humidity_above' =>
                isset($device->attributes['humidity'])
                && (float) $device->attributes['humidity'] > (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:hum_above"),

            'humidity_below' =>
                isset($device->attributes['humidity'])
                && (float) $device->attributes['humidity'] < (float) ($trigger['threshold'] ?? 0)
                && $this->notOnCooldown("auto:{$deviceId}:hum_below"),

            'motion' =>
                $device->status === 'on' && $previousStatus !== 'on',

            'door_open'   => $device->status === 'open'   && $previousStatus !== 'open',
            'door_closed' => $device->status === 'closed' && $previousStatus !== 'closed',

            'flood' => $device->status === 'on' && $previousStatus !== 'on',
            'smoke' => $device->status === 'on' && $previousStatus !== 'on',

            'battery_low' =>
                isset($device->attributes['battery'])
                && (float) $device->attributes['battery'] < (float) ($trigger['threshold'] ?? 20)
                && $this->notOnCooldown("auto:{$deviceId}:battery_low"),

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
        $type = $action['type'] ?? '';

        // Multi-Action: Teilaktionen nacheinander, ein Log-Eintrag
        if ($type === 'multi') {
            $items = $action['actions'] ?? [];
            if (!is_array($items)) {
                return;
            }
            $summaries = [];
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $this->executeSingleAction($item);
                $summaries[] = $this->describeAction($item);
            }
            if ($automationName !== '') {
                $summary = implode(' + ', array_filter($summaries));
                AutomationLog::create([
                    'automation_name' => $automationName,
                    'action_summary'  => $summary !== '' ? $summary : 'Mehrfachaktion',
                    'fired_at'        => now(),
                ]);
                AutomationFired::dispatch($automationName, $summary !== '' ? $summary : 'Mehrfachaktion');
            }
            return;
        }

        $summary = $this->describeAction($action);
        $this->executeSingleAction($action);

        if ($automationName) {
            AutomationLog::create([
                'automation_name' => $automationName,
                'action_summary'  => $summary,
                'fired_at'        => now(),
            ]);
            AutomationFired::dispatch($automationName, $summary);
        }
    }

    private function executeSingleAction(array $action): void
    {
        $this->actionExecutor->execute($action, allowActivateScene: true);
    }

    private function describeAction(array $action): string
    {
        $type = $action['type'] ?? '';

        if ($type === 'multi') {
            $items = $action['actions'] ?? [];
            if (!is_array($items) || $items === []) {
                return 'Mehrfachaktion';
            }
            $parts = [];
            foreach ($items as $item) {
                if (is_array($item)) {
                    $parts[] = $this->describeAction($item);
                }
            }
            return implode(' + ', $parts);
        }

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
            'set_thermostat_child_lock' => sprintf(
                '„%s" Kindersicherung %s',
                $deviceName(),
                ($action['locked'] ?? true) ? 'an' : 'aus'
            ),
            'set_thermostat_open_window' => sprintf(
                '„%s" Offenes-Fenster %s',
                $deviceName(),
                ($action['enabled'] ?? true) ? 'an' : 'aus'
            ),
            'set_thermostat_calibration' => sprintf(
                '„%s" Kalibrierung %s°C',
                $deviceName(),
                $action['value'] ?? '?'
            ),
            'set_thermostat_frost_protection' => sprintf(
                '„%s" Frostschutz %s°C',
                $deviceName(),
                $action['value'] ?? '?'
            ),
            'thermostat_boost' => sprintf(
                '„%s" Boost %d Min.',
                $deviceName(),
                (int) ($action['duration'] ?? 30)
            ),
            'thermostat_timer' => sprintf(
                '„%s" Timer %d Min. auf %s°C',
                $deviceName(),
                (int) ($action['duration'] ?? 60),
                $action['temperature'] ?? '?'
            ),
            'thermostat_clear_boost' => sprintf('„%s" Boost/Timer beenden', $deviceName()),
            'activate_scene' => sprintf(
                'Szene „%s" aktiviert',
                optional(Scene::find($action['scene_id'] ?? null))->name ?? '?'
            ),
            'notify'            => (string) ($action['message'] ?? ''),
            default             => $type,
        };
    }

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

    private function notOnCooldown(string $key): bool
    {
        if (Cache::has($key)) {
            return false;
        }
        Cache::put($key, true, now()->addMinutes(5));
        return true;
    }
}
