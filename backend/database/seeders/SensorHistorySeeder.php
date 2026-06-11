<?php

namespace Database\Seeders;

use App\Models\Device;
use App\Models\DeviceLog;
use Illuminate\Database\Seeder;

class SensorHistorySeeder extends Seeder
{
    public function run(): void
    {
        $sensors = Device::where('type', 'like', 'sensor_%')->get();

        foreach ($sensors as $sensor) {
            // Bestehende Sample-Logs entfernen
            DeviceLog::where('device_id', $sensor->id)->delete();

            $isTemp = $sensor->type === 'sensor_temperature';
            $base   = $isTemp ? 20.0 : 55.0;
            $range  = $isTemp ? 4.0  : 15.0;

            // 24h × 3 Messungen = 72 Datenpunkte pro Sensor
            for ($i = 0; $i < 24; $i++) {
                for ($j = 0; $j < 3; $j++) {
                    $val = round(
                        $base
                        + sin(($i + $j * 0.3) / 3.0) * $range * 0.5
                        + (rand(-10, 10) / 20.0),
                        1
                    );
                    DeviceLog::create([
                        'device_id'   => $sensor->id,
                        'status'      => (string) $val,
                        'recorded_at' => now()->subHours(24 - $i)->addMinutes($j * 18),
                    ]);
                }
            }

            $this->command->info("Sensor \"{$sensor->name}\" ({$sensor->type}): 72 Messwerte eingefügt");
        }
    }
}
