<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Device::with('room');

        if ($request->has('room_id')) {
            $query->where('room_id', $request->room_id);
        }

        return response()->json($query->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'       => 'required|string|max:255',
            'type'       => 'required|string',
            'room_id'    => 'required|exists:rooms,id',
            'mqtt_topic' => 'nullable|string|max:255',
            'attributes' => 'nullable|array',
            'active'     => 'sometimes|boolean',
        ]);

        return response()->json(Device::create($data), 201);
    }

    public function show(Device $device): JsonResponse
    {
        return response()->json($device->load('room'));
    }

    public function update(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate([
            'name'       => 'sometimes|string|max:255',
            'type'       => 'sometimes|string',
            'room_id'    => 'sometimes|exists:rooms,id',
            'mqtt_topic' => 'sometimes|string|max:255',
            'status'     => 'sometimes|string',
            'attributes' => 'nullable|array',
            'active'     => 'sometimes|boolean',
        ]);

        $device->update($data);

        return response()->json($device->load('room'));
    }

    public function destroy(Device $device): JsonResponse
    {
        $device->delete();

        return response()->json(null, 204);
    }
}
