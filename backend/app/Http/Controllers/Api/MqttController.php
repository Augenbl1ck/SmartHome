<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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
        $newStatus = $device->status === 'on' ? 'off' : 'on';

        // DeviceService kennt alle Protokolle: MQTT, HTTP, BLE Bridge
        $this->deviceService->setStatus($device, $newStatus);

        $device->update(['status' => $newStatus, 'last_seen' => now()]);

        return response()->json($device);
    }
}

