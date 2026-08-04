<?php

namespace App\Events;

use App\Models\Device;
use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DeviceStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public function __construct(public readonly Device $device)
    {
    }

    public function broadcastOn(): Channel
    {
        return new Channel('devices');
    }

    public function broadcastAs(): string
    {
        return 'device.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'id'         => $this->device->id,
            'status'     => $this->device->status,
            'attributes' => $this->device->attributes ?? [],
            'last_seen'  => $this->device->last_seen,
        ];
    }
}
