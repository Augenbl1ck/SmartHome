<?php

namespace App\Console\Commands;

use App\Models\Device;
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
            if ($device->wolIp() === null) {
                $this->warn("{$device->name}: keine IP hinterlegt");
                continue;
            }

            $previous = (string) $device->status;
            if ($wol->refreshDevice($device)) {
                $changed++;
                $this->line("{$device->name}: {$previous} → {$device->fresh()?->status}");
            }
        }

        $this->info("Checked {$devices->count()} computer(s), {$changed} status change(s)");

        return self::SUCCESS;
    }
}
