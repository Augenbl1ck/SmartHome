<?php

namespace App\Console\Commands;

use App\Services\DeviceService;
use Illuminate\Console\Command;

class ExpireThermostatTemporaryModeCommand extends Command
{
    protected $signature = 'thermostats:expire-temporary-mode';

    protected $description = 'Beendet Boost/Timer am TRV wenn die Zeit abgelaufen ist (setzt Solltemperatur zurück)';

    public function handle(DeviceService $devices): int
    {
        $n = $devices->expireTemporaryModes();
        if ($n > 0) {
            $this->info("{$n} Boost/Timer beendet");
        }

        return self::SUCCESS;
    }
}
