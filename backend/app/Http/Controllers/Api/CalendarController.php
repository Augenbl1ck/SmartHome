<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\CalendarService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CalendarController extends Controller
{
    public function __construct(private CalendarService $calendar) {}

    public function events(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => 'sometimes|date',
            'to' => 'sometimes|date|after_or_equal:from',
        ]);

        $from = isset($data['from'])
            ? Carbon::parse($data['from'])->startOfDay()
            : Carbon::now()->startOfDay();

        $to = isset($data['to'])
            ? Carbon::parse($data['to'])->endOfDay()
            : Carbon::now()->addDays(14)->endOfDay();

        return response()->json($this->calendar->events($from, $to));
    }
}
