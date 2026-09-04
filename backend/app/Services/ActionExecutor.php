<?php

namespace App\Services;

use App\Events\DeviceStatusUpdated;
use App\Exceptions\DeviceCommandBlockedException;
use App\Jobs\DelayedDeviceAction;
use App\Models\Device;
use App\Models\Scene;
use Illuminate\Support\Facades\Log;

/**
 * Führt typisierte Aktions-Objekte aus (Automationen + Szenen).
 */
class ActionExecutor
{
    public function __construct(private readonly DeviceService $deviceService) {}

    /**
     * @param  array<string, mixed>  $action
     * @return bool true = erledigt (nicht erneut versuchen), false = durch Sperre/Fehler blockiert
     */
    public function execute(array $action, bool $allowActivateScene = true): bool
    {
        $type = $action['type'] ?? '';

        return match ($type) {
            'set_device_status' => $this->execSetDeviceStatus($action),
            'toggle_device' => $this->execToggleDevice($action),
            'set_room_devices' => $this->execSetRoomDevices($action),
            'delayed_off' => $this->execDelayed($action, 'off'),
            'delayed_on' => $this->execDelayed($action, 'on'),
            'set_thermostat_setpoint' => $this->execThermostatSetpoint($action),
            'set_thermostat_mode' => $this->execThermostatMode($action),
            'set_thermostat_child_lock' => $this->execThermostatChildLock($action),
            'set_thermostat_open_window' => $this->execThermostatOpenWindow($action),
            'set_thermostat_calibration' => $this->execThermostatCalibration($action),
            'set_thermostat_frost_protection' => $this->execThermostatFrost($action),
            'activate_scene' => $this->execActivateScene($action, $allowActivateScene),
            'notify' => $this->execNotify($action),
            default => true,
        };
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execSetDeviceStatus(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device) {
            return true;
        }
        $status = (string) ($action['status'] ?? 'off');
        if ($device->isWakeOnLan()) {
            if (in_array(strtolower($status), ['on', 'wake'], true)) {
                return $this->trySetStatus($device, 'on');
            }

            return true;
        }
        if (! $this->trySetStatus($device, $status)) {
            return false;
        }
        if (in_array($status, ['on', 'off', 'open', 'close', 'stop', 'heat', 'auto'], true)) {
            $this->persist($device, ['status' => $status, 'last_seen' => now()]);
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execToggleDevice(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device) {
            return true;
        }
        if ($device->isWakeOnLan()) {
            if ($device->status !== 'on') {
                return $this->trySetStatus($device, 'on');
            }

            return true;
        }
        $status = $device->status === 'on' ? 'off' : 'on';
        if (! $this->trySetStatus($device, $status)) {
            return false;
        }
        $this->persist($device, ['status' => $status, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execSetRoomDevices(array $action): bool
    {
        $ok = true;
        Device::where('room_id', $action['room_id'] ?? null)
            ->where('active', true)
            ->where('type', '!=', 'thermostat')
            ->get()
            ->each(function ($d) use ($action, &$ok) {
                $status = (string) ($action['status'] ?? 'off');
                if ($d->isWakeOnLan()) {
                    if (in_array(strtolower($status), ['on', 'wake'], true) && ! $this->trySetStatus($d, 'on')) {
                        $ok = false;
                    }

                    return;
                }
                if (! $this->trySetStatus($d, $status)) {
                    $ok = false;

                    return;
                }
                $this->persist($d, ['status' => $status, 'last_seen' => now()]);
            });

        return $ok;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execDelayed(array $action, string $status): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if ($status === 'off' && $device && $device->isWakeOnLan()) {
            return true;
        }
        if ($device) {
            DelayedDeviceAction::dispatch($device->id, $status)
                ->delay(now()->addMinutes((int) ($action['minutes'] ?? 10)));
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execThermostatSetpoint(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device || $device->type !== 'thermostat') {
            return true;
        }
        $setpoint = round((float) ($action['setpoint'] ?? 21), 1);
        $setpoint = max(4.0, min(35.0, $setpoint));
        if (! $this->trySetStatus($device, (string) $setpoint)) {
            return false;
        }
        $attrs = $device->attributes ?? [];
        $attrs['setpoint'] = $setpoint;
        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execThermostatMode(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device || $device->type !== 'thermostat') {
            return true;
        }
        $mode = strtolower((string) ($action['mode'] ?? 'heat'));
        if (! in_array($mode, ['off', 'auto', 'heat'], true)) {
            return true;
        }
        if (! $this->trySetStatus($device, $mode)) {
            return false;
        }
        $this->persist($device, ['status' => $mode, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execThermostatChildLock(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device || $device->type !== 'thermostat') {
            return true;
        }
        $locked = (bool) ($action['locked'] ?? true);
        $cap = ThermostatCapabilities::encodeCapStatus('child_lock', $locked ? 'LOCK' : 'UNLOCK');
        if (! $this->trySetStatus($device, $cap)) {
            return false;
        }
        $attrs = $device->attributes ?? [];
        $attrs['child_lock'] = $locked ? 'LOCK' : 'UNLOCK';
        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execThermostatOpenWindow(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device || $device->type !== 'thermostat') {
            return true;
        }
        $on = (bool) ($action['enabled'] ?? true);
        $cap = ThermostatCapabilities::encodeCapStatus('open_window', $on ? 'ON' : 'OFF');
        if (! $this->trySetStatus($device, $cap)) {
            return false;
        }
        $attrs = $device->attributes ?? [];
        $attrs['open_window'] = $on ? 'ON' : 'OFF';
        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execThermostatCalibration(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device || $device->type !== 'thermostat') {
            return true;
        }
        $val = round((float) ($action['value'] ?? 0), 1);
        $val = max(-12.7, min(12.7, $val));
        $cap = ThermostatCapabilities::encodeCapStatus('local_temperature_calibration', (string) $val);
        if (! $this->trySetStatus($device, $cap)) {
            return false;
        }
        $attrs = $device->attributes ?? [];
        $attrs['local_temperature_calibration'] = $val;
        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execThermostatFrost(array $action): bool
    {
        $device = Device::find($action['device_id'] ?? null);
        if (! $device || $device->type !== 'thermostat') {
            return true;
        }
        $val = round((float) ($action['value'] ?? 5), 1);
        $val = max(4.0, min(35.0, $val));
        $cap = ThermostatCapabilities::encodeCapStatus('frost_protection_temperature', (string) $val);
        if (! $this->trySetStatus($device, $cap)) {
            return false;
        }
        $attrs = $device->attributes ?? [];
        $attrs['frost_protection_temperature'] = $val;
        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execActivateScene(array $action, bool $allowActivateScene): bool
    {
        if (! $allowActivateScene) {
            return true;
        }
        $scene = Scene::find($action['scene_id'] ?? null);
        if ($scene) {
            app(SceneService::class)->activate($scene);
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $action
     */
    private function execNotify(array $action): bool
    {
        $message = $action['message'] ?? 'Automation ausgelöst';
        app(PushNotificationService::class)->send('SmartHome', $message);
        Log::info('[ActionExecutor] Push gesendet: '.$message);

        return true;
    }

    /**
     * @param  array<string, mixed>  $fields
     */
    private function persist(Device $device, array $fields): void
    {
        $device->update($fields);
        $fresh = $device->fresh();
        if ($fresh) {
            DeviceStatusUpdated::dispatch($fresh);
        }
    }

    private function trySetStatus(Device $device, string $status): bool
    {
        try {
            $this->deviceService->setStatus($device, $status);

            return true;
        } catch (DeviceCommandBlockedException $e) {
            Log::info("[ActionExecutor] Übersprungen {$device->name} → {$status}: {$e->getMessage()}");

            return false;
        } catch (\Throwable $e) {
            Log::error("[ActionExecutor] {$device->name} → {$status}: {$e->getMessage()}");

            return false;
        }
    }
}
