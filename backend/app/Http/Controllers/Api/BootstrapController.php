<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\Room;
use App\Models\Scene;
use App\Services\CalendarService;
use App\Services\EnergyService;
use App\Services\TransitService;
use App\Services\WeatherService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;

class BootstrapController extends Controller
{
    public function __construct(
        private WeatherService $weather,
        private TransitService $transit,
        private EnergyService $energy,
        private CalendarService $calendar,
    ) {}

    /** GET /api/v1/bootstrap */
    public function show(): JsonResponse
    {
        $now = Carbon::now('Europe/Berlin');
        $from = $now->copy()->startOfMonth()->subDays(7)->startOfDay();
        $to = $now->copy()->endOfMonth()->addDays(7)->endOfDay();

        return response()->json([
            'rooms'    => Room::withCount('devices')->get(),
            'devices'  => Device::with('room')->get(),
            'scenes'   => Scene::orderBy('name')->get(),
            'weather'  => $this->weather->forecast(),
            'transit'  => $this->transit->board(),
            'energy'   => $this->energy->overview(),
            'calendar' => $this->calendar->events($from, $to),
        ]);
    }
}
