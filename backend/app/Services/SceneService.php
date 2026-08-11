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
        foreach ($scene->actions ?? [] as $action) {
            if (!is_array($action)) {
                continue;
            }
            $normalized = $this->normalizeAction($action);
            if (($normalized['type'] ?? '') === 'activate_scene') {
                continue;
            }
            $this->actionExecutor->execute($normalized, allowActivateScene: false);
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
