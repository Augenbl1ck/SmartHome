<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\DeviceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceController extends Controller
{
    public function __construct(private DeviceService $deviceService) {}
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
            'mqtt_topic' => 'nullable|string|max:255',
            'status'     => 'sometimes|string',
            'attributes' => 'nullable|array',
            'active'     => 'sometimes|boolean',
        ]);

        $device->update($data);

        // Sensor-Messwerte in device_logs mitschreiben
        if (isset($data['status']) && str_starts_with($device->type, 'sensor_')) {
            \App\Models\DeviceLog::create([
                'device_id'   => $device->id,
                'status'      => $data['status'],
                'recorded_at' => now(),
            ]);
        }

        return response()->json($device->load('room'));
    }

    public function destroy(Device $device): JsonResponse
    {
        $device->delete();

        return response()->json(null, 204);
    }

    public function setStatus(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate(['status' => 'required|string|max:64']);
        $status = $data['status'];
        $this->deviceService->setStatus($device, $status);

        // Thermostat: Solltemperatur gehört in attributes.setpoint,
        // status bleibt der Modus (off/auto/heat) — sonst zeigt die UI immer "Aktiv".
        if ($device->type === 'thermostat' && is_numeric($status)) {
            $attrs = $device->attributes ?? [];
            $attrs['setpoint'] = (float) $status;
            $device->update([
                'attributes' => $attrs,
                'last_seen'  => now(),
            ]);
        } else {
            $device->update([
                'status'    => strtolower($status),
                'last_seen' => now(),
            ]);
        }

        return response()->json($device->fresh());
    }
}
