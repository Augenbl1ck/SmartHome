<?php

namespace App\Services;

use App\Models\Device;
use App\Models\Scene;

class SceneService
{
    public function __construct(private readonly DeviceService $deviceService) {}

    /**
     * Aktiviert eine Szene: setzt alle Geräte gemäss Scene-Actions.
     */
    public function activate(Scene $scene): void
    {
        foreach ($scene->actions ?? [] as $action) {
            $device = Device::find($action['device_id'] ?? null);
            if (!$device) {
                continue;
            }

            $status = $action['status'] ?? 'off';
            if ($status === 'toggle') {
                $status = $device->status === 'on' ? 'off' : 'on';
            }

            $this->deviceService->setStatus($device, $status);
            $device->update(['status' => $status, 'last_seen' => now()]);
        }
    }
}
