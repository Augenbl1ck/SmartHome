<?php

namespace App\Services;

use App\Models\Automation;
use App\Models\Device;
use Illuminate\Support\Collection;

/**
 * Geräte-Sperren (Automationen mit trigger.type = interlock).
 * Feuern nicht — sie verbieten einen Befehl, solange die Bedingungen wahr sind.
 */
class InterlockService
{
    /** @var Collection<int, Automation>|null */
    private ?Collection $cached = null;

    public function blockedReason(Device $device, string $command): ?string
    {
        $command = strtolower($command);
        if (! $this->isGuardable($command)) {
            return null;
        }

        foreach ($this->interlocks() as $automation) {
            $action = is_array($automation->action) ? $automation->action : [];
            if (($action['type'] ?? '') !== 'block_command') {
                continue;
            }
            if ((int) ($action['device_id'] ?? 0) !== (int) $device->id) {
                continue;
            }
            $blocked = strtolower((string) ($action['status'] ?? ''));
            if (! $this->commandMatches($blocked, $command, $device)) {
                continue;
            }
            if (app(AutomationEngine::class)->conditionsPass($automation->conditions)) {
                $name = trim((string) $automation->name);

                return $name !== '' ? $name : 'Kopplung';
            }
        }

        return null;
    }

    /**
     * @return array<string, string> command => reason
     */
    public function blockedCommands(Device $device): array
    {
        $out = [];
        foreach (['on', 'off', 'heat', 'auto', 'open', 'close', 'stop'] as $cmd) {
            $reason = $this->blockedReason($device, $cmd);
            if ($reason !== null) {
                $out[$cmd] = $reason;
            }
        }

        return $out;
    }

    private function isGuardable(string $command): bool
    {
        return in_array($command, ['on', 'off', 'wake', 'heat', 'auto', 'open', 'close', 'stop'], true);
    }

    private function commandMatches(string $blocked, string $command, Device $device): bool
    {
        if ($blocked === $command) {
            return true;
        }
        if ($command === 'wake' && $blocked === 'on') {
            return true;
        }
        if ($device->type === 'thermostat') {
            if ($blocked === 'heat' && in_array($command, ['on', 'heat'], true)) {
                return true;
            }
            if ($blocked === 'on' && in_array($command, ['on', 'heat', 'auto'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return Collection<int, Automation>
     */
    private function interlocks(): Collection
    {
        return $this->cached ??= Automation::query()
            ->where('enabled', true)
            ->get()
            ->filter(fn (Automation $a) => ($a->trigger['type'] ?? '') === 'interlock')
            ->values();
    }
}
