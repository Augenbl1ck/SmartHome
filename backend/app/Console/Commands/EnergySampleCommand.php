<?php

namespace App\Console\Commands;

use App\Models\Device;
use App\Models\EnergySample;
use Illuminate\Console\Command;

class EnergySampleCommand extends Command
{
    protected $signature = 'energy:sample';

    protected $description = 'Sample power_w / energy_wh from devices into energy_samples (every 5 min)';

    public function handle(): int
    {
        $now = now();
        $count = 0;

        $devices = Device::query()
            ->where('active', true)
            ->get(['id', 'type', 'attributes']);

        foreach ($devices as $device) {
            $attrs = is_array($device->attributes) ? $device->attributes : [];
            $hasPower = array_key_exists('power_w', $attrs) && is_numeric($attrs['power_w']);
            $hasEnergy = array_key_exists('energy_wh', $attrs) && is_numeric($attrs['energy_wh']);
            if (!$hasPower && !$hasEnergy) {
                continue;
            }

            EnergySample::create([
                'device_id' => $device->id,
                'power_w' => $hasPower ? round((float) $attrs['power_w'], 2) : null,
                'energy_wh' => $hasEnergy ? round((float) $attrs['energy_wh'], 2) : null,
                'recorded_at' => $now,
            ]);
            $count++;
        }

        EnergySample::where('recorded_at', '<', $now->copy()->subDays(90))->delete();

        $this->info("Sampled {$count} device(s)");

        return self::SUCCESS;
    }
}
