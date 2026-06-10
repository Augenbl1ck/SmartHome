<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\DeviceLog;
use Illuminate\Http\JsonResponse;

class DeviceLogController extends Controller
{
    public function index(Device $device): JsonResponse
    {
        $logs = DeviceLog::where('device_id', $device->id)
            ->orderByDesc('recorded_at')
            ->limit(100)
            ->get(['id', 'status', 'recorded_at']);

        return response()->json($logs);
    }
}
