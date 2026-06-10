<?php

namespace App\Console\Commands;

use App\Services\AutomationService;
use Illuminate\Console\Command;

class RunAutomations extends Command
{
    protected $signature   = 'automations:run';
    protected $description = 'Alle aktiven Automationen prüfen und ausführen (wird jede Minute vom Scheduler aufgerufen)';

    public function handle(AutomationService $automationService): int
    {
        $automationService->runAll();
        $this->info('Automationen geprüft: ' . now()->format('H:i:s'));
        return Command::SUCCESS;
    }
}
