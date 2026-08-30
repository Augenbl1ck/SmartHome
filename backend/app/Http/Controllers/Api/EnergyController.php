<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\EnergyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EnergyController extends Controller
{
    public function __construct(private EnergyService $energy) {}

    public function show(): JsonResponse
    {
        return response()->json($this->energy->overview());
    }

    public function history(Request $request): JsonResponse
    {
        $range = $request->query('range', 'day');
        if (!in_array($range, ['day', 'week', 'month', 'year'], true)) {
            $range = 'day';
        }

        return response()->json($this->energy->history($range));
    }
}
