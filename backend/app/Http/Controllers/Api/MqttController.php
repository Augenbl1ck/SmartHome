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

        try {
            $mqtt = new MqttClient(
                config('mqtt.host', '127.0.0.1'),
                (int) config('mqtt.port', 1883),
                config('mqtt.client_id', 'laravel-smarthome-toggle')
            );

            $settings = (new ConnectionSettings())->setConnectTimeout(3);
            $mqtt->connect($settings, true);

            $protocol = $device->attributes['protocol'] ?? 'simple';
            [$topic, $payload] = $this->buildCommand($device->mqtt_topic, $protocol, $newStatus);

            $mqtt->publish($topic, $payload, 0);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            // MQTT nicht verfügbar (Phase 1: kein Broker) – Status trotzdem in DB speichern
        }

        $device->update(['status' => $newStatus, 'last_seen' => now()]);

        return response()->json($device);
    }

    /**
     * Gibt [topic, payload] für das jeweilige Protokoll zurück.
     *
     * Protokolle:
     *  simple      → topic direkt, payload "on"/"off"
     *  shelly_gen3 → <base>/rpc, JSON-RPC Switch.Set
     *  shelly_gen1 → <base>/relay/0/command, payload "on"/"off"
     */
    private function buildCommand(string $base, string $protocol, string $status): array
    {
        $base = rtrim($base, '/');

        if ($protocol === 'shelly_gen3') {
            return [
                $base . '/rpc',
                json_encode([
                    'id'     => 1,
                    'src'    => 'smarthome',
                    'method' => 'Switch.Set',
                    'params' => ['id' => 0, 'on' => $status === 'on'],
                ]),
            ];
        }

        if ($protocol === 'shelly_gen1') {
            return [$base . '/relay/0/command', $status];
        }

        return [$base, $status];
    }
}
