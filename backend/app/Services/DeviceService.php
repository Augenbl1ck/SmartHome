<?php

namespace App\Services;

use App\Exceptions\DeviceCommandBlockedException;
use App\Models\Device;
use App\Models\DeviceLog;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Services\MqttHelper;
use PhpMqtt\Client\MqttClient;

/**
 * Zentraler Service für Gerätesteuerung.
 *
 * Protokolle:
 *   simple                  → MQTT (sendet "on"/"off" direkt ans Topic)
 *   shelly_gen1             → MQTT relay/0/command
 *   shelly_gen3             → MQTT JSON-RPC über <topic>/rpc
 *   shelly_gen3_http        → direktes HTTP (LAN)
 *   bluetooth_shelly_gen3   → BLE Bridge (Node.js Daemon auf dem Pi)
 *   zigbee2mqtt             → MQTT über Zigbee2MQTT (<topic>/set)
 *   wake_on_lan             → UDP Magic Packet (nur Starten)
 */
class DeviceService
{
    public function __construct(private readonly WakeOnLanService $wakeOnLan) {}

    public function setStatus(Device $device, string $status): void
    {
        $reason = app(InterlockService::class)->blockedReason($device, $status);
        if ($reason !== null) {
            throw new DeviceCommandBlockedException($device, $status, $reason);
        }

        $protocol = $device->attributes['protocol'] ?? 'simple';

        if ($protocol === 'wake_on_lan' || $device->type === 'computer') {
            $this->sendWakeOnLan($device, $status);
            if (in_array(strtolower($status), ['on', 'wake'], true)) {
                DeviceLog::create([
                    'device_id'   => $device->id,
                    'status'      => 'on',
                    'recorded_at' => now(),
                ]);
            }
            return;
        }

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
    // Wake-on-LAN
    // -------------------------------------------------------------------------

    private function sendWakeOnLan(Device $device, string $status): void
    {
        $lower = strtolower($status);
        if ($lower !== 'on' && $lower !== 'wake') {
            Log::info("[DeviceService] WOL ignoriert Status \"{$status}\" für {$device->name} (kein Ausschalten)");
            return;
        }

        $this->wakeOnLan->wakeDevice($device);
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
        [$topic, $payload] = $this->buildMqttCommand($device, $protocol, $status);

        try {
            $mqtt = new MqttClient(
                config('mqtt.host', '127.0.0.1'),
                (int) config('mqtt.port', 1883),
                'laravel-device-service'
            );
            $mqtt->connect(MqttHelper::settings(3), true);
            $mqtt->publish($topic, $payload, 0);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            Log::warning("[DeviceService] MQTT nicht verfügbar: " . $e->getMessage());
        }
    }

    /**
     * Thermostat-Befehle mit komplexem MQTT-Payload (Boost, Wochenplan, Ventil).
     *
     * @param  array<string, mixed>  $command
     * @return array<string, mixed>  Optimistic attribute patch
     */
    public function applyThermostatCommand(Device $device, array $command): array
    {
        if ($device->type !== 'thermostat') {
            throw new \InvalidArgumentException('Gerät ist kein Thermostat');
        }

        $type = (string) ($command['command'] ?? '');
        $payload = [];
        $attrsPatch = [];

        switch ($type) {
            case 'boost':
                $duration = max(0, min(180, (int) ($command['duration'] ?? 30)));
                $payload = [
                    'temporary_mode_select'   => 'boost',
                    'temporary_mode_duration' => $duration,
                ];
                $attrsPatch = [
                    'temporary_mode_select'   => 'boost',
                    'temporary_mode_duration' => $duration,
                ];
                break;

            case 'timer':
                $duration = max(0, min(1440, (int) ($command['duration'] ?? 60)));
                $temp = round((float) ($command['temperature'] ?? 21), 1);
                $temp = max(4.0, min(35.0, $temp));
                $payload = [
                    'temporary_mode_select'   => 'timer',
                    'temporary_mode_duration' => $duration,
                    'timer_mode_target_temp'  => $temp,
                ];
                $attrsPatch = [
                    'temporary_mode_select'   => 'timer',
                    'temporary_mode_duration' => $duration,
                    'timer_mode_target_temp'  => $temp,
                ];
                break;

            case 'clear_boost':
                $payload = [
                    'temporary_mode_duration' => 0,
                ];
                $attrsPatch = [
                    'temporary_mode_duration' => 0,
                ];
                break;

            default:
                throw new \InvalidArgumentException('Unbekannter Thermostat-Befehl');
        }

        $this->publishMqttJson($device, $payload);

        DeviceLog::create([
            'device_id'   => $device->id,
            'status'      => 'thermostat:' . $type,
            'recorded_at' => now(),
        ]);

        return $attrsPatch;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function publishMqttJson(Device $device, array $payload): void
    {
        if (!$device->mqtt_topic) {
            Log::warning("[DeviceService] Kein MQTT-Topic für {$device->name}");
            return;
        }

        $base = rtrim((string) $device->mqtt_topic, '/');
        $topic = $base . '/set';
        $json = json_encode($payload);

        try {
            $mqtt = new MqttClient(
                config('mqtt.host', '127.0.0.1'),
                (int) config('mqtt.port', 1883),
                'laravel-device-service-thermo'
            );
            $mqtt->connect(MqttHelper::settings(3), true);
            $mqtt->publish($topic, $json, 0);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            Log::warning("[DeviceService] MQTT nicht verfügbar: " . $e->getMessage());
        }
    }

    private function buildMqttCommand(Device $device, string $protocol, string $status): array
    {
        $base = rtrim((string) $device->mqtt_topic, '/');

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

        if ($protocol === 'zigbee2mqtt') {
            // Thermostat / TRV (z.B. SONOFF TRVZB)
            if ($device->type === 'thermostat') {
                // Generisches Capability-Schema: cap:<name>:<value>
                $cap = ThermostatCapabilities::parseCapStatus($status);
                if ($cap !== null) {
                    [$name, $value] = $cap;
                    $payload = ThermostatCapabilities::mqttPayload($name, $value);
                    if ($payload !== null) {
                        return [$base . '/set', json_encode($payload)];
                    }
                }

                // Kurzformen
                $lower = strtolower($status);
                if ($lower === 'lock' || $lower === 'unlock') {
                    return [
                        $base . '/set',
                        json_encode(ThermostatCapabilities::mqttPayload('child_lock', $lower === 'lock' ? 'LOCK' : 'UNLOCK')),
                    ];
                }
                if ($lower === 'open_window_on' || $lower === 'open_window_off') {
                    return [
                        $base . '/set',
                        json_encode(ThermostatCapabilities::mqttPayload(
                            'open_window',
                            $lower === 'open_window_on' ? 'ON' : 'OFF'
                        )),
                    ];
                }

                $mode = $lower;
                if (in_array($mode, ['off', 'auto', 'heat'], true)) {
                    return [
                        $base . '/set',
                        json_encode(['system_mode' => $mode]),
                    ];
                }
                if (is_numeric($status)) {
                    return [
                        $base . '/set',
                        json_encode(['occupied_heating_setpoint' => (float) $status]),
                    ];
                }
            }

            return [
                $base . '/set',
                json_encode(['state' => strtoupper($status)]),
            ];
        }

        return [$base, $status];
    }
}
