<?php

namespace App\Jobs;

use App\Models\Device;
use App\Services\DeviceService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class DelayedDeviceAction implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly int    $deviceId,
        public readonly string $status,
    ) {}

    public function handle(DeviceService $deviceService): void
    {
        $device = Device::find($this->deviceId);

        if ($device && $device->active) {
            $deviceService->setStatus($device, $this->status);
        }
    }
}
