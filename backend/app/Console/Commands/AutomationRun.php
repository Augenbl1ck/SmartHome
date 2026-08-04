<?php

namespace App\Console\Commands;

use App\Services\AutomationEngine;
use Illuminate\Console\Command;

class AutomationRun extends Command
{
    protected $signature   = 'automations:run';
    protected $description = 'Zeitbasierte Automationen ausführen (wird jede Minute vom Scheduler aufgerufen)';

    public function handle(AutomationEngine $engine): void
    {
        $engine->runTimeTriggers();
        $engine->checkOnDurationTriggers();
    }
}
