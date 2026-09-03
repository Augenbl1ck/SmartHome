<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\Room;
use App\Models\Scene;
use App\Services\WakeOnLanService;
use Illuminate\Http\JsonResponse;

class BootstrapController extends Controller
{
    public function __construct(private WakeOnLanService $wakeOnLan) {}

    /** GET /api/v1/bootstrap */
    public function show(): JsonResponse
    {
        $devices = Device::with('room')->get();
        foreach ($devices as $device) {
            if ($device->isWakeOnLan()) {
                $this->wakeOnLan->refreshDevice($device);
                $device->refresh();
                $device->load('room');
            }
        }

        return response()->json([
            'rooms'   => Room::withCount('devices')->get(),
            'devices' => $devices,
            'scenes'  => Scene::orderBy('name')->get(),
        ]);
    }
}
