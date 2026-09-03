<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Events\DeviceStatusUpdated;
use App\Models\Device;
use App\Services\DeviceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PhpMqtt\Client\MqttClient;
use App\Services\MqttHelper;

class MqttController extends Controller
{
    public function __construct(private DeviceService $deviceService) {}

    public function publish(Request $request): JsonResponse
    {
        $data = $request->validate([
            'topic'   => 'required|string',
            'payload' => 'required|string',
        ]);

        $mqtt = new MqttClient(
            config('mqtt.host', '127.0.0.1'),
            (int) config('mqtt.port', 1883),
            config('mqtt.client_id', 'laravel-smarthome-pub')
        );

        $mqtt->connect(MqttHelper::settings(5), true);
        $mqtt->publish($data['topic'], $data['payload'], 0);
        $mqtt->disconnect();

        return response()->json(['published' => true]);
    }

    public function toggleDevice(Request $request, Device $device): JsonResponse
    {
        if ($device->isWakeOnLan()) {
            try {
                if ($device->status !== 'on') {
                    $this->deviceService->setStatus($device, 'on');
                    $device->update(['last_seen' => now()]);
                }
            } catch (\RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 503);
            }

            return response()->json($device->fresh());
        }

        $newStatus = $device->status === 'on' ? 'off' : 'on';

        try {
            $this->deviceService->setStatus($device, $newStatus);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }

        $device->update(['status' => $newStatus, 'last_seen' => now()]);
        DeviceStatusUpdated::dispatch($device->fresh() ?? $device);

        return response()->json($device->fresh() ?? $device);
    }
}

