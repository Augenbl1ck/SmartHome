<?php

namespace App\Services;

use App\Models\Scene;

class SceneService
{
    public function __construct(private readonly ActionExecutor $actionExecutor) {}

    /**
     * Aktiviert eine Szene: setzt alle Geräte gemäss Scene-Actions.
     * Legacy { device_id, status } wird auf typisierte Actions gemappt.
     * activate_scene innerhalb einer Szene wird ignoriert (keine Rekursion).
     */
    public function activate(Scene $scene): void
    {
        $queue = [];
        foreach ($scene->actions ?? [] as $action) {
            if (! is_array($action)) {
                continue;
            }
            $normalized = $this->normalizeAction($action);
            if (($normalized['type'] ?? '') === 'activate_scene') {
                continue;
            }
            $queue[] = $normalized;
        }

        $maxPasses = max(1, count($queue));
        for ($pass = 0; $pass < $maxPasses && $queue !== []; $pass++) {
            $remaining = [];
            $progress = false;
            foreach ($queue as $action) {
                if ($this->actionExecutor->execute($action, allowActivateScene: false)) {
                    $progress = true;
                } else {
                    $remaining[] = $action;
                }
            }
            if (! $progress) {
                break;
            }
            $queue = $remaining;
        }
    }

    /**
     * @param  array<string, mixed>  $action
     * @return array<string, mixed>
     */
    public function normalizeAction(array $action): array
    {
        if (isset($action['type']) && is_string($action['type']) && $action['type'] !== '') {
            return $action;
        }

        // Legacy: { device_id, status: on|off|toggle|open|close|stop }
        $status = (string) ($action['status'] ?? 'off');
        if ($status === 'toggle') {
            return [
                'type'      => 'toggle_device',
                'device_id' => $action['device_id'] ?? null,
            ];
        }

        return [
            'type'      => 'set_device_status',
            'device_id' => $action['device_id'] ?? null,
            'status'    => $status,
        ];
    }
}
