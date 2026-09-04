<?php

namespace App\Console\Commands;

use App\Services\CalendarService;
use App\Services\EnergyService;
use App\Services\TransitService;
use App\Services\WeatherService;
use Carbon\Carbon;
use Illuminate\Console\Command;

class RefreshDashboardCacheCommand extends Command
{
    protected $signature = 'dashboard:refresh-cache {--only= : weather, transit, calendar oder energy}';

    protected $description = 'Aktualisiert Wetter/Bahn/Kalender/Energie-Snapshots im Hintergrund';

    public function handle(
        WeatherService $weather,
        TransitService $transit,
        CalendarService $calendar,
        EnergyService $energy,
    ): int {
        $only = $this->option('only');
        $only = is_string($only) && $only !== '' ? $only : null;

        if ($only === null || $only === 'weather') {
            $weather->refresh();
            $this->line('weather ✓');
        }

        if ($only === null || $only === 'transit') {
            $transit->refreshBoard();
            $this->line('transit ✓');
        }

        if ($only === null || $only === 'calendar') {
            $now = Carbon::now('Europe/Berlin');
            $from = $now->copy()->startOfMonth()->subDays(7)->startOfDay();
            $to = $now->copy()->endOfMonth()->addDays(7)->endOfDay();
            $calendar->refresh($from, $to);
            $this->line('calendar ✓');
        }

        if ($only === null || $only === 'energy') {
            $energy->refreshOverview();
            $this->line('energy ✓');
        }

        return self::SUCCESS;
    }
}
