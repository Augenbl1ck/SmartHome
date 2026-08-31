<?php

namespace App\Console\Commands;

use App\Services\AutomationEngine;
use Illuminate\Console\Command;

class AutomationRun extends Command
{
    protected $signature   = 'automations:run';
    protected $description = 'Automationen ausführen (Conditions + Legacy-Zeit/Dauer, jede Minute)';

    public function handle(AutomationEngine $engine): void
    {
        $engine->runTimeTriggers();
        $engine->checkOnDurationTriggers();
        app(\App\Services\DeviceService::class)->applyAllZigbeeLedNightModes();
    }
}
