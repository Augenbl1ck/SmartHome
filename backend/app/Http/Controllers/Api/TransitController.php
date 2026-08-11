<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\TransitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TransitController extends Controller
{
    public function __construct(private TransitService $transit) {}

    public function stops(Request $request): JsonResponse
    {
        $data = $request->validate([
            'q' => 'required|string|min:2|max:120',
        ]);

        try {
            return response()->json(['stops' => $this->transit->searchLocations($data['q'])]);
        } catch (\Throwable $e) {
            return response()->json([
                'stops' => [],
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function board(): JsonResponse
    {
        try {
            return response()->json($this->transit->board());
        } catch (\Throwable $e) {
            return response()->json([
                'configured' => true,
                'stations' => [],
                'connections' => [],
                'error' => $e->getMessage(),
            ]);
        }
    }
}
