<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\Device;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

/**
 * Wertet alle aktiven Automationen aus und führt Aktionen durch.
 * Wird vom Laravel Scheduler jede Minute aufgerufen.
 *
 * Unterstützte Trigger:
 *   time            → täglich um HH:MM
 *   weekday_time    → bestimmte Wochentage um HH:MM (0=So, 1=Mo, ..., 6=Sa)
 *   device_status   → wenn Gerät einen bestimmten Status hat
 *
 * Unterstützte Aktionen:
 *   set_device_status  → Gerät auf 'on'/'off' setzen
 *   toggle_device      → Gerät umschalten
 *   set_room_devices   → alle Geräte in einem Raum setzen
 *   delayed_off        → nach X Minuten ausschalten (einmalig, via dispatch)
 *   delayed_on         → nach X Minuten einschalten (einmalig, via dispatch)
 */
class AutomationService
{
    public function __construct(private DeviceService $deviceService) {}

    /**
     * Alle aktivierten Automationen prüfen und ggf. ausführen.
     */
    public function runAll(): void
    {
        $automations = Automation::where('enabled', true)->get();
        $now = Carbon::now();

        foreach ($automations as $automation) {
            try {
                $this->evaluate($automation, $now);
            } catch (\Exception $e) {
                Log::error("[AutomationService] Fehler bei '{$automation->name}': " . $e->getMessage());
            }
        }
    }

    private function evaluate(Automation $automation, Carbon $now): void
    {
        $trigger = $automation->trigger;
        $type    = $trigger['type'] ?? '';

        $shouldFire = match ($type) {
            'time'          => $this->checkTime($trigger, $now),
            'weekday_time'  => $this->checkWeekdayTime($trigger, $now),
            'device_status' => $this->checkDeviceStatus($trigger),
            default         => false,
        };

        if (!$shouldFire) {
            return;
        }

        Log::info("[AutomationService] Automation '{$automation->name}' wird ausgeführt");
        $this->executeAction($automation->action ?? []);
    }

    // -------------------------------------------------------------------------
    // Trigger-Prüfungen
    // -------------------------------------------------------------------------

    private function checkTime(array $trigger, Carbon $now): bool
    {
        $time = $trigger['time'] ?? '';
        return $now->format('H:i') === $time;
    }

    private function checkWeekdayTime(array $trigger, Carbon $now): bool
    {
        if ($now->format('H:i') !== ($trigger['time'] ?? '')) {
            return false;
        }
        $weekdays = $trigger['weekdays'] ?? [];
        // Carbon: dayOfWeek → 0=So, 1=Mo, ..., 6=Sa
        return in_array($now->dayOfWeek, $weekdays, true);
    }

    private function checkDeviceStatus(array $trigger): bool
    {
        $device = Device::find($trigger['device_id'] ?? null);
        if (!$device) {
            return false;
        }
        return $device->status === ($trigger['status'] ?? '');
    }

    // -------------------------------------------------------------------------
    // Aktions-Ausführung
    // -------------------------------------------------------------------------

    private function executeAction(array $action): void
    {
        $type = $action['type'] ?? '';

        match ($type) {
            'set_device_status' => $this->actionSetDevice($action),
            'toggle_device'     => $this->actionToggleDevice($action),
            'set_room_devices'  => $this->actionSetRoomDevices($action),
            'delayed_off'       => $this->actionDelayed($action, 'off'),
            'delayed_on'        => $this->actionDelayed($action, 'on'),
            'notify'            => Log::info("[AutomationService] Notify: " . ($action['message'] ?? '')),
            default             => Log::warning("[AutomationService] Unbekannter Aktionstyp: {$type}"),
        };
    }

    private function actionSetDevice(array $action): void
    {
        $device = Device::find($action['device_id'] ?? null);
        if (!$device) {
            return;
        }

        $status = $action['status'] ?? 'off';
        $this->deviceService->setStatus($device, $status);
        $device->update(['status' => $status, 'last_seen' => now()]);
    }

    private function actionToggleDevice(array $action): void
    {
        $device = Device::find($action['device_id'] ?? null);
        if (!$device) {
            return;
        }

        $newStatus = $device->status === 'on' ? 'off' : 'on';
        $this->deviceService->setStatus($device, $newStatus);
        $device->update(['status' => $newStatus, 'last_seen' => now()]);
    }

    private function actionSetRoomDevices(array $action): void
    {
        $devices = Device::where('room_id', $action['room_id'] ?? null)->get();
        $status  = $action['status'] ?? 'off';

        foreach ($devices as $device) {
            $this->deviceService->setStatus($device, $status);
            $device->update(['status' => $status, 'last_seen' => now()]);
        }
    }

    private function actionDelayed(array $action, string $status): void
    {
        $minutes  = (int) ($action['minutes'] ?? 10);
        $deviceId = $action['device_id'] ?? null;

        if (!$deviceId) {
            return;
        }

        // Job mit Verzögerung dispatchen
        \App\Jobs\SetDeviceStatusJob::dispatch($deviceId, $status)
            ->delay(now()->addMinutes($minutes));

        Log::info("[AutomationService] Verzögertes {$status} in {$minutes} Min. für Gerät #{$deviceId}");
    }
}
