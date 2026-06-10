<?php

namespace App\Services;

use App\Models\Device;
use App\Models\DeviceLog;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

/**
 * Zentraler Service für Gerätesteuerung.
 *
 * Protokolle:
 *   simple                  → MQTT
 *   shelly_gen1             → MQTT
 *   shelly_gen3             → MQTT
 *   shelly_gen3_http        → direktes HTTP (LAN, ideal für Raspberry Pi)
 *   bluetooth_shelly_gen3   → BLE Bridge (Node.js Daemon auf dem Pi)
 */
class DeviceService
{
    public function setStatus(Device $device, string $status): void
    {
        $protocol = $device->attributes['protocol'] ?? 'simple';

        match (true) {
            $protocol === 'shelly_gen3_http'      => $this->sendHttp($device, $status),
            $protocol === 'bluetooth_shelly_gen3' => $this->sendBleBridge($device, $status),
            default                               => $this->sendMqtt($device, $status),
        };

        DeviceLog::create([
            'device_id'   => $device->id,
            'status'      => $status,
            'recorded_at' => now(),
        ]);
    }

    // -------------------------------------------------------------------------
    // HTTP (Shelly Gen3 LAN)
    // -------------------------------------------------------------------------

    private function sendHttp(Device $device, string $status): void
    {
        // mqtt_topic wird hier als IP-Adresse / Hostname verwendet
        $host = rtrim($device->mqtt_topic ?? '', '/');

        $url = "http://{$host}/rpc/Switch.Set";

        try {
            $response = Http::timeout(5)->post($url, [
                'id' => 0,
                'on' => $status === 'on',
            ]);

            if (!$response->successful()) {
                Log::warning("[DeviceService] HTTP Fehler bei {$device->name}: " . $response->status());
            }
        } catch (\Exception $e) {
            Log::error("[DeviceService] HTTP nicht erreichbar {$device->name}: " . $e->getMessage());
        }
    }

    // -------------------------------------------------------------------------
    // BLE Bridge (Node.js Daemon, läuft auf dem Pi, Port 3001)
    // -------------------------------------------------------------------------

    private function sendBleBridge(Device $device, string $status): void
    {
        $bridgeUrl = config('smarthome.ble_bridge_url', 'http://localhost:3001');

        try {
            $response = Http::timeout(3)->post("{$bridgeUrl}/switch", [
                'deviceId'  => $device->id,
                'bleAddress' => $device->attributes['ble_address'] ?? null,
                'on'        => $status === 'on',
            ]);

            if (!$response->successful()) {
                Log::warning("[DeviceService] BLE Bridge Fehler bei {$device->name}: " . $response->body());
            }
        } catch (\Exception $e) {
            Log::error("[DeviceService] BLE Bridge nicht erreichbar: " . $e->getMessage());
        }
    }

    // -------------------------------------------------------------------------
    // MQTT (Shelly Gen1, Gen3 MQTT, simple)
    // -------------------------------------------------------------------------

    private function sendMqtt(Device $device, string $status): void
    {
        if (!$device->mqtt_topic) {
            Log::warning("[DeviceService] Kein MQTT-Topic für {$device->name}");
            return;
        }

        $protocol = $device->attributes['protocol'] ?? 'simple';
        [$topic, $payload] = $this->buildMqttCommand($device->mqtt_topic, $protocol, $status);

        try {
            $mqtt = new MqttClient(
                config('mqtt.host', '127.0.0.1'),
                (int) config('mqtt.port', 1883),
                'laravel-device-service'
            );
            $settings = (new ConnectionSettings())->setConnectTimeout(3);
            $mqtt->connect($settings, true);
            $mqtt->publish($topic, $payload, 0);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            Log::warning("[DeviceService] MQTT nicht verfügbar: " . $e->getMessage());
        }
    }

    private function buildMqttCommand(string $base, string $protocol, string $status): array
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
