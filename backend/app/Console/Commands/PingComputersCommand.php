<?php

namespace App\Console\Commands;

use App\Events\DeviceStatusUpdated;
use App\Models\Device;
use App\Services\AutomationEngine;
use App\Services\WakeOnLanService;
use Illuminate\Console\Command;

class PingComputersCommand extends Command
{
    protected $signature = 'devices:ping-computers';

    protected $description = 'Ping Wake-on-LAN computers and update on/off status';

    public function handle(WakeOnLanService $wol): int
    {
        $devices = Device::query()
            ->where('active', true)
            ->get()
            ->filter(fn (Device $d) => $d->isWakeOnLan());

        $changed = 0;

        foreach ($devices as $device) {
            $ip = $device->wolIp();
            if ($ip === null) {
                continue;
            }

            $online = $wol->ping($ip);
            $newStatus = $online ? 'on' : 'off';
            $previous = (string) $device->status;

            if ($newStatus !== $previous) {
                $device->update([
                    'status'    => $newStatus,
                    'last_seen' => now(),
                ]);
                $fresh = $device->fresh();
                if ($fresh) {
                    DeviceStatusUpdated::dispatch($fresh);
                    app(AutomationEngine::class)->onDeviceUpdated($fresh, $previous);
                }
                $changed++;
                $this->line("{$device->name}: {$previous} → {$newStatus}");
            } elseif ($online) {
                $device->update(['last_seen' => now()]);
            }
        }

        $this->info("Checked {$devices->count()} computer(s), {$changed} status change(s)");

        return self::SUCCESS;
    }
}
