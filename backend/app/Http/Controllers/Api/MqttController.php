<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PhpMqtt\Client\MqttClient;
use PhpMqtt\Client\ConnectionSettings;

class MqttController extends Controller
{
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

        $settings = (new ConnectionSettings())->setConnectTimeout(5);
        $mqtt->connect($settings, true);
        $mqtt->publish($data['topic'], $data['payload'], 0);
        $mqtt->disconnect();

        return response()->json(['published' => true]);
    }

    public function toggleDevice(Request $request, Device $device): JsonResponse
    {
        $newStatus = $device->status === 'on' ? 'off' : 'on';

        $mqtt = new MqttClient(
            config('mqtt.host', '127.0.0.1'),
            (int) config('mqtt.port', 1883),
            config('mqtt.client_id', 'laravel-smarthome-toggle')
        );

        $settings = (new ConnectionSettings())->setConnectTimeout(5);
        $mqtt->connect($settings, true);
        $mqtt->publish($device->mqtt_topic, $newStatus, 0);
        $mqtt->disconnect();

        $device->update(['status' => $newStatus]);

        return response()->json($device);
    }
}
