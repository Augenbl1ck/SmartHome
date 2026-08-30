<?php

namespace App\Services;

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
                            $this->deviceService->setStatus($device, 'on');
                        }
                        break;
                    }
                    $this->deviceService->setStatus($device, $status);
                    if (in_array($status, ['on', 'off', 'open', 'close', 'stop'], true)) {
                        $device->update(['status' => $status, 'last_seen' => now()]);
                    }
                }
                break;

            case 'toggle_device':
                $device = Device::find($action['device_id'] ?? null);
                if ($device) {
                    if ($device->isWakeOnLan()) {
                        if ($device->status !== 'on') {
                            $this->deviceService->setStatus($device, 'on');
                        }
                        break;
                    }
                    $status = $device->status === 'on' ? 'off' : 'on';
                    $this->deviceService->setStatus($device, $status);
                    $device->update(['status' => $status, 'last_seen' => now()]);
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
                                $this->deviceService->setStatus($d, 'on');
                            }
                            return;
                        }
                        $this->deviceService->setStatus($d, $status);
                        $d->update(['status' => $status, 'last_seen' => now()]);
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
                    $this->deviceService->setStatus($device, (string) $setpoint);
                    $attrs = $device->attributes ?? [];
                    $attrs['setpoint'] = $setpoint;
                    $device->update(['attributes' => $attrs, 'last_seen' => now()]);
                }
                break;

            case 'set_thermostat_mode':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $mode = strtolower((string) ($action['mode'] ?? 'heat'));
                    if (in_array($mode, ['off', 'auto', 'heat'], true)) {
                        $this->deviceService->setStatus($device, $mode);
                        $device->update(['status' => $mode, 'last_seen' => now()]);
                    }
                }
                break;

            case 'set_thermostat_child_lock':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $locked = (bool) ($action['locked'] ?? true);
                    $this->deviceService->setStatus(
                        $device,
                        ThermostatCapabilities::encodeCapStatus('child_lock', $locked ? 'LOCK' : 'UNLOCK')
                    );
                    $attrs = $device->attributes ?? [];
                    $attrs['child_lock'] = $locked ? 'LOCK' : 'UNLOCK';
                    $device->update(['attributes' => $attrs, 'last_seen' => now()]);
                }
                break;

            case 'set_thermostat_open_window':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $on = (bool) ($action['enabled'] ?? true);
                    $this->deviceService->setStatus(
                        $device,
                        ThermostatCapabilities::encodeCapStatus('open_window', $on ? 'ON' : 'OFF')
                    );
                    $attrs = $device->attributes ?? [];
                    $attrs['open_window'] = $on ? 'ON' : 'OFF';
                    $device->update(['attributes' => $attrs, 'last_seen' => now()]);
                }
                break;

            case 'set_thermostat_calibration':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $val = round((float) ($action['value'] ?? 0), 1);
                    $val = max(-12.7, min(12.7, $val));
                    $this->deviceService->setStatus(
                        $device,
                        ThermostatCapabilities::encodeCapStatus('local_temperature_calibration', (string) $val)
                    );
                    $attrs = $device->attributes ?? [];
                    $attrs['local_temperature_calibration'] = $val;
                    $device->update(['attributes' => $attrs, 'last_seen' => now()]);
                }
                break;

            case 'set_thermostat_frost_protection':
                $device = Device::find($action['device_id'] ?? null);
                if ($device && $device->type === 'thermostat') {
                    $val = round((float) ($action['value'] ?? 5), 1);
                    $val = max(4.0, min(35.0, $val));
                    $this->deviceService->setStatus(
                        $device,
                        ThermostatCapabilities::encodeCapStatus('frost_protection_temperature', (string) $val)
                    );
                    $attrs = $device->attributes ?? [];
                    $attrs['frost_protection_temperature'] = $val;
                    $device->update(['attributes' => $attrs, 'last_seen' => now()]);
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
}
