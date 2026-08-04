<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class AutomationFired implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly string $automationName,
        public readonly string $actionSummary,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('automations');
    }

    public function broadcastAs(): string
    {
        return 'automation.fired';
    }

    public function broadcastWith(): array
    {
        return [
            'name'    => $this->automationName,
            'summary' => $this->actionSummary,
        ];
    }
}
