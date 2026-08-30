<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->hourly();

// Automationen jede Minute prüfen
Schedule::command('automations:run')->everyMinute();

// Computer-Online-Status (Wake-on-LAN) per Ping
Schedule::command('devices:ping-computers')->everyMinute();

// Energie-Samples alle 5 Minuten
Schedule::command('energy:sample')->everyFiveMinutes();
