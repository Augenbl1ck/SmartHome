<?php

namespace App\Http\Controllers\Api;

use App\Events\DeviceStatusUpdated;
use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\DeviceService;
use App\Services\WakeOnLanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceController extends Controller
{
    public function __construct(
        private DeviceService $deviceService,
        private WakeOnLanService $wakeOnLan,
    ) {}
    public function index(Request $request): JsonResponse
    {
        $query = Device::with('room');

        if ($request->has('room_id')) {
            $query->where('room_id', $request->room_id);
        }

        $devices = $query->get();
        foreach ($devices as $device) {
            $this->refreshComputerIfNeeded($device);
        }

        return response()->json($devices);
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

        $device = Device::create($data);
        if ($device->isWakeOnLan()) {
            $this->wakeOnLan->refreshDevice($device);
        }

        return response()->json($device->fresh()?->load('room') ?? $device, 201);
    }

    public function show(Device $device): JsonResponse
    {
        $this->refreshComputerIfNeeded($device);

        return response()->json($device->fresh()?->load('room') ?? $device->load('room'));
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

        if ($device->isWakeOnLan()) {
            $this->wakeOnLan->refreshDevice($device);
        }

        return response()->json($device->fresh()?->load('room') ?? $device);
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
        try {
            $this->deviceService->setStatus($device, $status);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        // Wake-on-LAN: Status kommt vom Ping, nicht vom Magic Packet
        if ($device->isWakeOnLan()) {
            $device->update(['last_seen' => now()]);

            return response()->json($device->fresh());
        }

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

        $fresh = $device->fresh();
        if ($fresh) {
            DeviceStatusUpdated::dispatch($fresh);
        }

        return response()->json($fresh);
    }

    public function thermostatCommand(Request $request, Device $device): JsonResponse
    {
        if ($device->type !== 'thermostat') {
            return response()->json(['message' => 'Gerät ist kein Thermostat'], 422);
        }

        $data = $request->validate([
            'command'      => 'required|string|in:boost,timer,clear_boost',
            'duration'     => 'nullable|integer|min:0|max:1440',
            'temperature'  => 'nullable|numeric|min:4|max:35',
        ]);

        try {
            $patch = $this->deviceService->applyThermostatCommand($device, $data);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        $attrs = array_merge($device->attributes ?? [], $patch);
        $device->update([
            'attributes' => $attrs,
            'last_seen'  => now(),
        ]);
        $fresh = $device->fresh();
        if ($fresh) {
            DeviceStatusUpdated::dispatch($fresh);
        }

        return response()->json($fresh);
    }

    /**
     * POST /api/v1/devices/{device}/zigbee-set
     *
     * Schreibt Zigbee2MQTT-Exposes nach zigbee2mqtt/<name>/set (oder /get).
     */
    public function zigbeeSet(Request $request, Device $device): JsonResponse
    {
        $protocol = $device->extra()['protocol'] ?? null;
        if ($protocol !== 'zigbee2mqtt') {
            return response()->json(['message' => 'Gerät ist kein Zigbee2MQTT-Gerät'], 422);
        }

        $isGet = $request->boolean('_get');
        $raw = $request->except(['_get']);
        if (!is_array($raw) || $raw === [] || array_is_list($raw)) {
            return response()->json(['message' => 'Leerer oder ungültiger Payload'], 422);
        }

        $mqttAllowed = [
            'power_outage_memory',
            'indicator_mode',
            'child_lock',
            'countdown',
            'switch_type_button',
            'identify',
        ];
        $localAllowed = ['led_night_enable', 'led_night_from', 'led_night_to', 'led_day_mode'];

        $payload = [];
        $local = [];
        foreach ($raw as $key => $value) {
            if (!is_string($key)) {
                continue;
            }
            if (in_array($key, $mqttAllowed, true)) {
                $payload[$key] = $value;
            } elseif (in_array($key, $localAllowed, true)) {
                $local[$key] = $value;
            }
        }

        if ($payload === [] && $local === []) {
            return response()->json(['message' => 'Keine gültigen Zigbee-Felder'], 422);
        }

        if ($isGet) {
            if ($payload === []) {
                return response()->json(['message' => 'Keine gültigen Zigbee-Felder'], 422);
            }
            $this->deviceService->publishMqttJson($device, $payload, 'get');

            return response()->json($device->fresh());
        }

        $attrs = $device->extra();
        $dayModes = ['off', 'off/on', 'on/off', 'on'];

        if (isset($local['led_day_mode']) && in_array((string) $local['led_day_mode'], $dayModes, true)) {
            $attrs['led_day_mode'] = (string) $local['led_day_mode'];
        } elseif (isset($payload['indicator_mode']) && in_array((string) $payload['indicator_mode'], $dayModes, true)) {
            $attrs['led_day_mode'] = (string) $payload['indicator_mode'];
        }

        if (array_key_exists('led_night_enable', $local)) {
            $attrs['led_night_enable'] = filter_var($local['led_night_enable'], FILTER_VALIDATE_BOOLEAN);
        }
        foreach (['led_night_from', 'led_night_to'] as $timeKey) {
            if (!isset($local[$timeKey]) || !is_string($local[$timeKey])) {
                continue;
            }
            if (preg_match('/^(\d{1,2}):(\d{2})/', $local[$timeKey], $m) === 1) {
                $h = (int) $m[1];
                $min = (int) $m[2];
                if ($h <= 23 && $min <= 59) {
                    $attrs[$timeKey] = sprintf('%02d:%02d', $h, $min);
                }
            }
        }

        foreach ($payload as $key => $value) {
            if ($key === 'identify' || $key === 'indicator_mode') {
                continue;
            }
            $attrs[$key] = $value;
        }

        $device->update([
            'attributes' => $attrs,
            'last_seen' => now(),
        ]);

        $mqttPublish = $payload;
        unset($mqttPublish['indicator_mode']);
        if ($mqttPublish !== []) {
            $this->deviceService->publishMqttJson($device, $mqttPublish);
        }

        $this->deviceService->applyLedNightMode($device->fresh() ?? $device);

        return response()->json($device->fresh());
    }

    private function refreshComputerIfNeeded(Device $device): void
    {
        if (! $device->isWakeOnLan() || $device->wolIp() === null) {
            return;
        }

        $last = $device->attributes['last_ping_at'] ?? null;
        if (is_string($last)) {
            try {
                if (\Illuminate\Support\Carbon::parse($last)->greaterThan(now()->subSeconds(15))) {
                    return;
                }
            } catch (\Throwable) {
                // ungültiges Datum → neu pingen
            }
        }

        $this->wakeOnLan->refreshDevice($device);
    }
}
