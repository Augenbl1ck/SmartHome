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
     */
    public function execute(array $action, bool $allowActivateScene = true): void
    {
        $type = $action['type'] ?? '';

        switch ($type) {
            case 'set_device_status':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    $status = (string) ($action['status'] ?? 'off');
                    if ($device->isWakeOnLan()) {
                        if (in_array(strtolower($status), ['on', 'wake'], true)) {
                            $this->trySetStatus($device, 'on');
                        }
                        break;
                    }
                    if ($this->trySetStatus($device, $status)) {
                        if (in_array($status, ['on', 'off', 'open', 'close', 'stop', 'heat', 'auto'], true)) {
                            $this->persist($device, ['status' => $status, 'last_seen' => now()]);
                        }
                    }
                }
                break;

            case 'toggle_device':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    if ($device->isWakeOnLan()) {
                        if ($device->status !== 'on') {
                            $this->trySetStatus($device, 'on');
                        }
                        break;
                    }
                    $status = $device->status === 'on' ? 'off' : 'on';
                    if ($this->trySetStatus($device, $status)) {
                        $this->persist($device, ['status' => $status, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_room_devices':
                Device::where('room_id', $action['room_id'] ?? null)
                    ->where('active', true)
                    ->where('type', '!=', 'thermostat')
                    ->get()
                    ->each(function ($d) use ($action) {
                        $status = (string) ($action['status'] ?? 'off');
                        if ($d->isWakeOnLan()) {
                            if (in_array(strtolower($status), ['on', 'wake'], true)) {
                                $this->trySetStatus($d, 'on');
                            }
                            return;
                        }
                        if ($this->trySetStatus($d, $status)) {
                            $this->persist($d, ['status' => $status, 'last_seen' => now()]);
                        }
                    });
                break;

            case 'delayed_off':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && ! $device->isWakeOnLan()) {
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
                    if ($this->trySetStatus($device, (string) $setpoint)) {
                        $attrs = $device->attributes ?? [];
                        $attrs['setpoint'] = $setpoint;
                        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_thermostat_mode':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $mode = strtolower((string) ($action['mode'] ?? 'heat'));
                    if (in_array($mode, ['off', 'auto', 'heat'], true) && $this->trySetStatus($device, $mode)) {
                        $this->persist($device, ['status' => $mode, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_thermostat_child_lock':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $locked = (bool) ($action['locked'] ?? true);
                    $cap = ThermostatCapabilities::encodeCapStatus('child_lock', $locked ? 'LOCK' : 'UNLOCK');
                    if ($this->trySetStatus($device, $cap)) {
                        $attrs = $device->attributes ?? [];
                        $attrs['child_lock'] = $locked ? 'LOCK' : 'UNLOCK';
                        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_thermostat_open_window':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $on = (bool) ($action['enabled'] ?? true);
                    $cap = ThermostatCapabilities::encodeCapStatus('open_window', $on ? 'ON' : 'OFF');
                    if ($this->trySetStatus($device, $cap)) {
                        $attrs = $device->attributes ?? [];
                        $attrs['open_window'] = $on ? 'ON' : 'OFF';
                        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_thermostat_calibration':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $val = round((float) ($action['value'] ?? 0), 1);
                    $val = max(-12.7, min(12.7, $val));
                    $cap = ThermostatCapabilities::encodeCapStatus('local_temperature_calibration', (string) $val);
                    if ($this->trySetStatus($device, $cap)) {
                        $attrs = $device->attributes ?? [];
                        $attrs['local_temperature_calibration'] = $val;
                        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_thermostat_frost_protection':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $val = round((float) ($action['value'] ?? 5), 1);
                    $val = max(4.0, min(35.0, $val));
                    $cap = ThermostatCapabilities::encodeCapStatus('frost_protection_temperature', (string) $val);
                    if ($this->trySetStatus($device, $cap)) {
                        $attrs = $device->attributes ?? [];
                        $attrs['frost_protection_temperature'] = $val;
                        $this->persist($device, ['attributes' => $attrs, 'last_seen' => now()]);
                    }
                }
                break;

            case 'activate_scene':
                if (!$allowActivateScene) {
                    break;
                }
                $scene = Scene::find($action['scene_id'] ?? null);
                if ($scene) {
                    app(SceneService::class)->activate($scene);
                }
                break;

            case 'notify':
                $message = $action['message'] ?? 'Automation ausgelöst';
                app(PushNotificationService::class)->send('SmartHome', $message);
                Log::info('[ActionExecutor] Push gesendet: ' . $message);
                break;
        }
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
