<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

class DiscoverController
{
    /**
     * Gibt alle bei Zigbee2MQTT bekannten Geräte zurück.
     *
     * Zigbee2MQTT publiziert die Geräteliste als retained Message auf
     * zigbee2mqtt/bridge/devices — der Broker liefert sie sofort beim Subscribe.
     */
    public function zigbee(): JsonResponse
    {
        $host = config('mqtt.host', '127.0.0.1');
        $port = (int) config('mqtt.port', 1883);

        $devices = [];
        $received = false;

        try {
            $mqtt = new MqttClient($host, $port, 'laravel-discover-' . uniqid());
            $settings = (new ConnectionSettings())->setConnectTimeout(3);
            $mqtt->connect($settings, true);

            $mqtt->subscribe('zigbee2mqtt/bridge/devices', function (string $topic, string $payload) use (&$devices, &$received, $mqtt) {
                $list = json_decode($payload, true);
                if (!is_array($list)) return;

                foreach ($list as $item) {
                    $name = $item['friendly_name'] ?? null;
                    if (!$name || $name === 'Coordinator') continue;

                    $definition = $item['definition'] ?? [];
                    $description = strtolower($definition['description'] ?? '');

                    $devices[] = [
                        'friendly_name' => $name,
                        'ieee_address'  => $item['ieee_address'] ?? null,
                        'vendor'        => $definition['vendor'] ?? null,
                        'model'         => $definition['model'] ?? null,
                        'description'   => $definition['description'] ?? null,
                        'supported'     => $item['supported'] ?? false,
                        'device_type'   => $this->inferDeviceType($description),
                        'mqtt_topic'    => 'zigbee2mqtt/' . $name,
                        'protocol'      => 'zigbee2mqtt',
                        'source'        => 'zigbee2mqtt',
                    ];
                }

                $received = true;
                $mqtt->interrupt();
            }, 0);

            // Maximal 3 Sekunden warten (retained Message kommt normalerweise sofort)
            $mqtt->loop(true, true, 3);
            $mqtt->disconnect();

        } catch (\Exception $e) {
            Log::warning('[Discover] Zigbee2MQTT nicht erreichbar: ' . $e->getMessage());
            return response()->json(['error' => 'Zigbee2MQTT nicht erreichbar. Ist der Broker und Zigbee2MQTT gestartet?'], 503);
        }

        if (!$received) {
            return response()->json(['error' => 'Keine Antwort von Zigbee2MQTT. Ist Zigbee2MQTT gestartet?'], 503);
        }

        return response()->json($devices);
    }

    /**
     * Sucht alle Geräte die sich jemals am MQTT-Broker gemeldet haben.
     *
     * Shelly und andere Geräte posten ihre Online-Meldung als retained Message,
     * sodass der Broker sie sofort liefert — auch ohne aktive Verbindung.
     *
     * Zusätzlich werden Zigbee-Geräte aus Zigbee2MQTT einbezogen.
     */
    public function all(): JsonResponse
    {
        $host = config('mqtt.host', '127.0.0.1');
        $port = (int) config('mqtt.port', 1883);

        $devices  = [];
        $zigbee   = [];
        $deadline = microtime(true) + 4;

        try {
            $mqtt = new MqttClient($host, $port, 'laravel-discover-all-' . uniqid());
            $settings = (new ConnectionSettings())->setConnectTimeout(3);
            $mqtt->connect($settings, true);

            // Shelly: postet "<device-id>/online" als retained
            $mqtt->subscribe('+/online', function (string $topic, string $payload) use (&$devices) {
                $deviceId = str_replace('/online', '', $topic);

                // Nur Shelly-Geräte (Präfix "shelly")
                if (!str_starts_with(strtolower($deviceId), 'shelly')) return;

                $online = strtolower(trim($payload)) === 'true';

                // Protokoll anhand der ID erkennen
                $protocol = str_contains($deviceId, 'plugs') || str_starts_with($deviceId, 'shellyplugsg3')
                    ? 'shelly_gen3' : 'shelly_gen3';

                $devices[$deviceId] = [
                    'friendly_name' => $deviceId,
                    'ieee_address'  => null,
                    'vendor'        => 'Shelly',
                    'model'         => $deviceId,
                    'description'   => $online ? 'Online' : 'Zuletzt online',
                    'supported'     => true,
                    'device_type'   => 'plug',
                    'mqtt_topic'    => $deviceId,
                    'protocol'      => $protocol,
                    'source'        => 'shelly',
                ];
            }, 0);

            // Zigbee2MQTT: Geräteliste (retained)
            $mqtt->subscribe('zigbee2mqtt/bridge/devices', function (string $topic, string $payload) use (&$zigbee, $mqtt) {
                $list = json_decode($payload, true);
                if (!is_array($list)) return;

                foreach ($list as $item) {
                    $name = $item['friendly_name'] ?? null;
                    if (!$name || $name === 'Coordinator') continue;

                    $definition  = $item['definition'] ?? [];
                    $description = strtolower($definition['description'] ?? '');

                    $zigbee[] = [
                        'friendly_name' => $name,
                        'ieee_address'  => $item['ieee_address'] ?? null,
                        'vendor'        => $definition['vendor'] ?? null,
                        'model'         => $definition['model'] ?? null,
                        'description'   => $definition['description'] ?? null,
                        'supported'     => $item['supported'] ?? false,
                        'device_type'   => $this->inferDeviceType($description),
                        'mqtt_topic'    => 'zigbee2mqtt/' . $name,
                        'protocol'      => 'zigbee2mqtt',
                        'source'        => 'zigbee2mqtt',
                    ];
                }
            }, 0);

            // 4 Sekunden lauschen um alle retained Messages zu empfangen
            $mqtt->loop(true, true, 4);
            $mqtt->disconnect();

        } catch (\Exception $e) {
            Log::warning('[Discover] MQTT nicht erreichbar: ' . $e->getMessage());
            return response()->json(['error' => 'MQTT-Broker nicht erreichbar. Ist Mosquitto gestartet?'], 503);
        }

        $result = array_merge(array_values($devices), $zigbee);

        return response()->json($result);
    }

    private function inferDeviceType(string $description): string
    {
        if (str_contains($description, 'plug') || str_contains($description, 'socket') || str_contains($description, 'outlet')) {
            return 'plug';
        }
        if (str_contains($description, 'thermostat') || str_contains($description, 'trv') || str_contains($description, 'radiator')) {
            return 'thermostat';
        }
        if (str_contains($description, 'temperature') || str_contains($description, 'humidity') || str_contains($description, 'sensor')) {
            return 'sensor_temperature';
        }
        if (str_contains($description, 'contact') || str_contains($description, 'door') || str_contains($description, 'window')) {
            return 'sensor_contact';
        }
        if (str_contains($description, 'motion') || str_contains($description, 'presence') || str_contains($description, 'occupancy')) {
            return 'sensor_motion';
        }
        if (str_contains($description, 'light') || str_contains($description, 'bulb') || str_contains($description, 'lamp')) {
            return 'light';
        }
        if (str_contains($description, 'switch') || str_contains($description, 'relay')) {
            return 'switch';
        }

        return 'plug';
    }
}
