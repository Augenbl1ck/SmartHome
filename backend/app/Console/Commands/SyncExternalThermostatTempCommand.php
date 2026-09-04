<?php

namespace App\Console\Commands;

use App\Services\DeviceService;
use Illuminate\Console\Command;

class SyncExternalThermostatTempCommand extends Command
{
    protected $signature = 'thermostats:sync-external-temp';

    protected $description = 'Sendet verknüpfte Raumfühler-Temperatur erneut an TRVZB (Heartbeat gegen 2h-Fallback)';

    public function handle(DeviceService $devices): int
    {
        $n = $devices->syncAllExternalThermostats();
        $this->info("{$n} Thermostat(e) synchronisiert");

        return self::SUCCESS;
    }
}
