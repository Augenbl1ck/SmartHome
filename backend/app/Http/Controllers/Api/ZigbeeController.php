<?php

namespace App\Http\Controllers\Api;

use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Services\MqttHelper;
use PhpMqtt\Client\MqttClient;

class ZigbeeController
{
    private function mqttHost(): string { return config('mqtt.host', '127.0.0.1'); }
    private function mqttPort(): int    { return (int) config('mqtt.port', 1883); }

    private function publish(string $topic, string $payload): void
    {
        $mqtt = new MqttClient($this->mqttHost(), $this->mqttPort(), 'laravel-z2m-pub-' . uniqid());
        $mqtt->connect(MqttHelper::settings(3), true);
        $mqtt->publish($topic, $payload, 0);
        $mqtt->disconnect();
    }

    private function requestAndWait(string $reqTopic, string $resTopic, string $payload, int $timeoutSec = 4): ?array
    {
        $response = null;
        try {
            $mqtt = new MqttClient($this->mqttHost(), $this->mqttPort(), 'laravel-z2m-rr-' . uniqid());
            $mqtt->connect(MqttHelper::settings(3), true);
            $mqtt->subscribe($resTopic, function (string $t, string $p) use (&$response, $mqtt) {
                $response = json_decode($p, true);
                $mqtt->interrupt();
            }, 0);
            $mqtt->publish($reqTopic, $payload, 0);
            $mqtt->loop(true, true, $timeoutSec);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            Log::warning('[Zigbee] MQTT error: ' . $e->getMessage());
        }
        return $response;
    }

    /** GET /api/v1/zigbee/devices */
    public function devices(): JsonResponse
    {
        $devices = [];
        $received = false;
        try {
            $mqtt = new MqttClient($this->mqttHost(), $this->mqttPort(), 'laravel-z2m-dev-' . uniqid());
            $mqtt->connect(MqttHelper::settings(3), true);
            $mqtt->subscribe('zigbee2mqtt/bridge/devices', function (string $t, string $p) use (&$devices, &$received, $mqtt) {
                $list = json_decode($p, true);
                if (!is_array($list)) return;
                foreach ($list as $item) {
                    if (($item['type'] ?? '') === 'Coordinator') continue;
                    $devices[] = $item;
                }
                $received = true;
                $mqtt->interrupt();
            }, 0);
            $mqtt->loop(true, true, 2);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            return response()->json(['error' => 'Zigbee2MQTT nicht erreichbar'], 503);
        }
        if (!$received) {
            return response()->json(['error' => 'Keine Antwort von Zigbee2MQTT'], 503);
        }

        // Mit SmartHome-Gerät verknüpfen falls vorhanden
        $linked = Device::whereNotNull('mqtt_topic')
            ->where('mqtt_topic', 'like', 'zigbee2mqtt/%')
            ->get()
            ->keyBy(fn($d) => ltrim(str_replace('zigbee2mqtt/', '', $d->mqtt_topic), '/'));

        foreach ($devices as &$dev) {
            $name = $dev['friendly_name'] ?? null;
            $dev['smarthome_device'] = $name && isset($linked[$name]) ? $linked[$name] : null;
        }
        unset($dev);

        return response()->json($devices);
    }

    /** POST /api/v1/zigbee/permit-join  body: {enable: bool, timeout?: int} */
    public function permitJoin(Request $request): JsonResponse
    {
        $data = $request->validate([
            'enable'  => 'required|boolean',
            'timeout' => 'integer|min:0|max:254',
        ]);

        $payload = json_encode([
            'value' => $data['enable'],
            'time'  => $data['timeout'] ?? ($data['enable'] ? 120 : 0),
        ]);

        try {
            $this->publish('zigbee2mqtt/bridge/request/permit_join', $payload);
        } catch (\Exception $e) {
            Log::warning('[Zigbee] permit_join: ' . $e->getMessage());
            return response()->json(['error' => 'Zigbee2MQTT nicht erreichbar'], 503);
        }

        return response()->json(['ok' => true]);
    }

    /** PATCH /api/v1/zigbee/devices/{ieee}  body: {name: string} */
    public function rename(Request $request, string $ieee): JsonResponse
    {
        $data = $request->validate(['name' => 'required|string|max:100']);

        $res = $this->requestAndWait(
            'zigbee2mqtt/bridge/request/device/rename',
            'zigbee2mqtt/bridge/response/device/rename',
            json_encode(['from' => $ieee, 'to' => $data['name']])
        );

        if ($res === null || ($res['status'] ?? '') === 'error') {
            return response()->json(['error' => $res['error'] ?? 'Umbenennen fehlgeschlagen'], 422);
        }

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/v1/zigbee/devices/{ieee}?force=&block=&clear_cache= */
    public function remove(Request $request, string $ieee): JsonResponse
    {
        $payload = [
            'id'          => $ieee,
            'force'       => filter_var($request->query('force', false), FILTER_VALIDATE_BOOLEAN),
            'block'       => filter_var($request->query('block', false), FILTER_VALIDATE_BOOLEAN),
            'clear_cache' => filter_var($request->query('clear_cache', false), FILTER_VALIDATE_BOOLEAN),
        ];

        $res = $this->requestAndWait(
            'zigbee2mqtt/bridge/request/device/remove',
            'zigbee2mqtt/bridge/response/device/remove',
            json_encode($payload),
            15
        );

        if ($res === null || ($res['status'] ?? '') === 'error') {
            return response()->json(['error' => $res['error'] ?? 'Entfernen fehlgeschlagen'], 422);
        }

        return response()->json(['ok' => true]);
    }

    /** POST /api/v1/zigbee/devices/{ieee}/interview */
    public function interview(string $ieee): JsonResponse
    {
        try {
            $this->publish(
                'zigbee2mqtt/bridge/request/device/interview',
                json_encode(['id' => $ieee])
            );
        } catch (\Exception $e) {
            Log::warning('[Zigbee] interview: ' . $e->getMessage());
            return response()->json(['error' => 'Zigbee2MQTT nicht erreichbar'], 503);
        }

        return response()->json(['ok' => true]);
    }

    /** POST /api/v1/zigbee/devices/{ieee}/import  body: {name, type, room_id} */
    public function import(Request $request, string $ieee): JsonResponse
    {
        $data = $request->validate([
            'name'    => 'required|string|max:100',
            'type'    => 'required|string',
            'room_id' => 'required|integer|exists:rooms,id',
            'vendor'  => 'nullable|string|max:100',
            'model'   => 'nullable|string|max:100',
        ]);

        $friendlyName = $request->input('friendly_name', $ieee);
        $topic = 'zigbee2mqtt/' . $friendlyName;

        $vendor = is_string($data['vendor'] ?? null) ? trim($data['vendor']) : '';
        $model = is_string($data['model'] ?? null) ? trim($data['model']) : '';
        if ($vendor === '' || $model === '') {
            $bridge = $this->findBridgeDevice($ieee);
            if (is_array($bridge)) {
                $def = is_array($bridge['definition'] ?? null) ? $bridge['definition'] : [];
                if ($vendor === '' && isset($def['vendor'])) {
                    $vendor = trim((string) $def['vendor']);
                }
                if ($model === '' && isset($def['model'])) {
                    $model = trim((string) $def['model']);
                }
            }
        }

        $attrs = ['protocol' => 'zigbee2mqtt', 'ieee_address' => $ieee];
        if ($vendor !== '') {
            $attrs['vendor'] = $vendor;
        }
        if ($model !== '') {
            $attrs['model'] = $model;
        }

        $device = Device::create([
            'name'       => $data['name'],
            'type'       => $data['type'],
            'room_id'    => $data['room_id'],
            'mqtt_topic' => $topic,
            'status'     => 'off',
            'active'     => true,
            'attributes' => $attrs,
        ]);

        return response()->json($device, 201);
    }

    /** @return array<string, mixed>|null */
    private function findBridgeDevice(string $ieee): ?array
    {
        try {
            $found = null;
            $mqtt = new MqttClient($this->mqttHost(), $this->mqttPort(), 'laravel-z2m-find-' . uniqid());
            $mqtt->connect(MqttHelper::settings(3), true);
            $mqtt->subscribe('zigbee2mqtt/bridge/devices', function (string $t, string $p) use ($ieee, &$found, $mqtt) {
                $list = json_decode($p, true);
                if (!is_array($list)) {
                    $mqtt->interrupt();
                    return;
                }
                foreach ($list as $item) {
                    if (!is_array($item)) {
                        continue;
                    }
                    if (strcasecmp((string) ($item['ieee_address'] ?? ''), $ieee) === 0) {
                        $found = $item;
                        break;
                    }
                }
                $mqtt->interrupt();
            }, 0);
            $mqtt->loop(true, true, 3);
            $mqtt->disconnect();

            return is_array($found) ? $found : null;
        } catch (\Exception $e) {
            Log::warning('[Zigbee] Lookup beim Import: ' . $e->getMessage());

            return null;
        }
    }
}
