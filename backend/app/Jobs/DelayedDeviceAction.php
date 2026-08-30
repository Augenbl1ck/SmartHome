<?php

namespace App\Jobs;

use App\Exceptions\DeviceCommandBlockedException;
use App\Models\Device;
use App\Services\DeviceService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

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

        if (! $device || ! $device->active) {
            return;
        }

        try {
            $deviceService->setStatus($device, $this->status);
        } catch (DeviceCommandBlockedException $e) {
            Log::info("[DelayedDeviceAction] Übersprungen {$device->name} → {$this->status}: {$e->getMessage()}");
        }
    }
}
