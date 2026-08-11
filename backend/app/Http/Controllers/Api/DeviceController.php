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

        // Thermostat: Solltemperatur → attributes.setpoint; Caps → attributes; Mode → status
        if ($device->type === 'thermostat') {
            $attrs = $device->attributes ?? [];

            if (is_numeric($status)) {
                $attrs['setpoint'] = (float) $status;
                $device->update([
                    'attributes' => $attrs,
                    'last_seen'  => now(),
                ]);
            } elseif (str_starts_with($status, 'cap:')) {
                $cap = \App\Services\ThermostatCapabilities::parseCapStatus($status);
                if ($cap !== null) {
                    [$name, $value] = $cap;
                    if ($name === 'child_lock') {
                        $attrs['child_lock'] = strtoupper($value);
                    } elseif ($name === 'open_window') {
                        $attrs['open_window'] = strtoupper($value);
                    } elseif ($name === 'local_temperature_calibration' && is_numeric($value)) {
                        $attrs['local_temperature_calibration'] = (float) $value;
                    } elseif ($name === 'frost_protection_temperature' && is_numeric($value)) {
                        $attrs['frost_protection_temperature'] = (float) $value;
                    }
                }
                $device->update([
                    'attributes' => $attrs,
                    'last_seen'  => now(),
                ]);
            } elseif (in_array(strtolower($status), ['lock', 'unlock'], true)) {
                $attrs['child_lock'] = strtolower($status) === 'lock' ? 'LOCK' : 'UNLOCK';
                $device->update([
                    'attributes' => $attrs,
                    'last_seen'  => now(),
                ]);
            } elseif (in_array(strtolower($status), ['open_window_on', 'open_window_off'], true)) {
                $attrs['open_window'] = strtolower($status) === 'open_window_on' ? 'ON' : 'OFF';
                $device->update([
                    'attributes' => $attrs,
                    'last_seen'  => now(),
                ]);
            } elseif (in_array(strtolower($status), ['off', 'auto', 'heat'], true)) {
                $device->update([
                    'status'    => strtolower($status),
                    'last_seen' => now(),
                ]);
            } else {
                $device->update(['last_seen' => now()]);
            }
        } else {
            $device->update([
                'status'    => strtolower($status),
                'last_seen' => now(),
            ]);
        }

        return response()->json($device->fresh());
    }

    public function thermostatCommand(Request $request, Device $device): JsonResponse
    {
        if ($device->type !== 'thermostat') {
            return response()->json(['message' => 'Gerät ist kein Thermostat'], 422);
        }

        $data = $request->validate([
            'command'      => 'required|string|in:boost,timer,clear_boost,schedule_day,valve',
            'duration'     => 'nullable|integer|min:0|max:1440',
            'temperature'  => 'nullable|numeric|min:4|max:35',
            'day'          => 'nullable|string|in:sunday,monday,tuesday,wednesday,thursday,friday,saturday',
            'transitions'  => 'nullable|string|max:255',
            'opening'      => 'nullable|integer|min:0|max:100',
            'closing'      => 'nullable|integer|min:0|max:100',
        ]);

        try {
            $patch = $this->deviceService->applyThermostatCommand($device, $data);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $attrs = array_merge($device->attributes ?? [], $patch);
        $device->update([
            'attributes' => $attrs,
            'last_seen'  => now(),
        ]);

        return response()->json($device->fresh());
    }
}
