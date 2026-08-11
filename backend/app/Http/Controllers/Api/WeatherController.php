<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\WeatherService;
use Illuminate\Http\JsonResponse;

class WeatherController extends Controller
{
    public function __construct(private WeatherService $weather) {}

    public function show(): JsonResponse
    {
        return response()->json($this->weather->forecast());
    }
}
