<?php

namespace App\Console\Commands;

use App\Events\DeviceStatusUpdated;
use App\Models\Device;
use App\Models\DeviceLog;
use App\Services\AutomationEngine;
use App\Services\MqttHelper;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

/**
 * Dauerhaft laufender MQTT-Subscriber.
 *
 * Empfängt Status-Updates von Geräten und schreibt sie in die Datenbank.
 *
 * Unterstützte Protokolle / Topic-Muster:
 *
 *   Shelly Gen3 MQTT
 *     <mqtt_topic>/status/switch:0     → on/off + Leistung
 *     <mqtt_topic>/online              → Verbindungsstatus
 *
 *   Zigbee2MQTT
 *     zigbee2mqtt/<friendly_name>      → Gerätestatus als JSON
 *
 *   Einfach / ESP32
 *     <mqtt_topic>                     → on/off oder numerischer Wert
 *
 * Starten:
 *   php artisan mqtt:subscribe
 */
class MqttSubscribe extends Command
{
    protected $signature   = 'mqtt:subscribe';
    protected $description = 'MQTT-Subscriber: empfängt Gerätestatus und schreibt ihn in die DB';

    public function handle(): void
    {
        $host = config('mqtt.host', '127.0.0.1');
        $port = (int) config('mqtt.port', 1883);

        $this->info("Verbinde mit MQTT-Broker {$host}:{$port} ...");

        try {
            $mqtt = new MqttClient($host, $port, 'laravel-subscriber-' . uniqid());
            $settings = MqttHelper::settings(5)->setKeepAliveInterval(60);
            $mqtt->connect($settings, true);
            $this->info('Verbunden. Warte auf Nachrichten...');
        } catch (\Exception $e) {
            $this->error('MQTT-Verbindung fehlgeschlagen: ' . $e->getMessage());
            return;
        }

        // Alle Topics abonnieren
        $mqtt->subscribe('#', function (string $topic, string $payload) {
            $this->processMqttMessage($topic, $payload);
        }, 0);

        // Endlosschleife — läuft bis Prozess beendet wird
        try {
            $mqtt->loop(true);
        } catch (\Exception $e) {
            Log::error('[MqttSubscribe] Loop-Fehler: ' . $e->getMessage());
            $this->error('Verbindung unterbrochen: ' . $e->getMessage());
        }
    }

    // -------------------------------------------------------------------------

    private function processMqttMessage(string $topic, string $payload): void
    {
        // Eigene Publish-Topics ignorieren
        if (str_ends_with($topic, '/rpc') && !str_contains($topic, 'smarthome')) {
            return;
        }

        // ----- Shelly Gen3: <base>/status/switch:0 -----
        if (str_ends_with($topic, '/status/switch:0')) {
            $base = str_replace('/status/switch:0', '', $topic);
            $this->handleShellySwitch($base, $payload);
            return;
        }

        // ----- Shelly Gen3: <base>/online -----
        if (str_ends_with($topic, '/online')) {
            $base = str_replace('/online', '', $topic);
            $this->handleOnline($base, trim($payload));
            return;
        }

        // ----- Zigbee2MQTT: zigbee2mqtt/<name> -----
        if (str_starts_with($topic, 'zigbee2mqtt/') && substr_count($topic, '/') === 1) {
            $this->handleZigbee($topic, $payload);
            return;
        }

        // ----- Einfaches Topic (ESP32 / generisch) -----
        $this->handleSimple($topic, $payload);
    }

    // -------------------------------------------------------------------------
    // Shelly Gen3 Switch-Status
    // -------------------------------------------------------------------------

    private function handleShellySwitch(string $base, string $payload): void
    {
        $device = $this->findDevice($base);
        if (!$device) {
            return;
        }

        $data = json_decode($payload, true);
        if (!is_array($data)) {
            return;
        }

        $on     = $data['output'] ?? null;
        $power  = $data['apower'] ?? null;   // Watt
        $energy = $data['aenergy']['total'] ?? null; // Wh

        if ($on === null) {
            return;
        }

        $status = $on ? 'on' : 'off';
        $previousStatus = $device->status;

        $attrs = $device->attributes ?? [];
        if ($power !== null) {
            $attrs['power_w'] = round($power, 1);
        }
        if ($energy !== null) {
            $attrs['energy_wh'] = round($energy, 1);
        }

        $device->update([
            'status'    => $status,
            'attributes'=> $attrs,
            'last_seen' => now(),
        ]);

        $fresh = $device->fresh();
        DeviceStatusUpdated::dispatch($fresh);
        app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);

        if ($status !== $previousStatus) {
            DeviceLog::create([
                'device_id'   => $device->id,
                'status'      => $status,
                'value'       => $power !== null ? (string) round($power, 1) : null,
                'recorded_at' => now(),
            ]);
        }

        $this->line("[Shelly] {$device->name}: {$status}" . ($power !== null ? " ({$power} W)" : ''));
    }

    // -------------------------------------------------------------------------
    // Online-Status
    // -------------------------------------------------------------------------

    private function handleOnline(string $base, string $payload): void
    {
        $device = $this->findDevice($base);
        if (!$device) {
            return;
        }

        $online = strtolower($payload) === 'true' || $payload === '1';

        $device->update(['last_seen' => now()]);

        $this->line("[Online] {$device->name}: " . ($online ? 'online' : 'offline'));
    }

    // -------------------------------------------------------------------------
    // Zigbee2MQTT
    // -------------------------------------------------------------------------

    private function handleZigbee(string $topic, string $payload): void
    {
        $device = $this->findDevice($topic);
        if (!$device) {
            return;
        }

        $data = json_decode($payload, true);
        if (!is_array($data)) {
            return;
        }

        $updates = ['last_seen' => now()];
        $attrs   = $device->attributes ?? [];
        $logStatus = null;
        $logValue  = null;
        $isThermostat = $device->type === 'thermostat';

        // Schalter / Steckdose — nicht für Thermostate (die nutzen system_mode)
        if (!$isThermostat && isset($data['state'])) {
            $status = strtolower($data['state']) === 'on' ? 'on' : 'off';
            $updates['status'] = $status;
            $logStatus = $status;
        }

        // Temperatursensor
        if (isset($data['temperature'])) {
            $temp = round((float) $data['temperature'], 1);
            $updates['status'] = (string) $temp;
            $attrs['temperature'] = $temp;
            $logValue = (string) $temp;
            $logStatus = 'temperature';
        }

        // Luftfeuchtigkeit
        if (isset($data['humidity'])) {
            $attrs['humidity'] = round((float) $data['humidity'], 1);
        }

        // Thermostat / TRV
        if ($isThermostat && isset($data['system_mode'])) {
            $mode = strtolower((string) $data['system_mode']);
            $updates['status'] = $mode;
            $logStatus = $mode;
        }
        if (isset($data['occupied_heating_setpoint'])) {
            $attrs['setpoint'] = (float) $data['occupied_heating_setpoint'];
        } elseif (isset($data['current_heating_setpoint'])) {
            $attrs['setpoint'] = (float) $data['current_heating_setpoint'];
        }
        if (isset($data['local_temperature'])) {
            $attrs['local_temperature'] = round((float) $data['local_temperature'], 1);
        }
        if (isset($data['running_state'])) {
            $attrs['running_state'] = strtolower((string) $data['running_state']);
        }
        if (isset($data['child_lock'])) {
            $attrs['child_lock'] = strtoupper((string) $data['child_lock']);
        }
        if (isset($data['open_window'])) {
            $ow = $data['open_window'];
            if (is_bool($ow)) {
                $attrs['open_window'] = $ow ? 'ON' : 'OFF';
            } else {
                $attrs['open_window'] = strtoupper((string) $ow);
            }
        }
        if (isset($data['local_temperature_calibration']) && is_numeric($data['local_temperature_calibration'])) {
            $attrs['local_temperature_calibration'] = round((float) $data['local_temperature_calibration'], 1);
        }
        if (isset($data['frost_protection_temperature']) && is_numeric($data['frost_protection_temperature'])) {
            $attrs['frost_protection_temperature'] = round((float) $data['frost_protection_temperature'], 1);
        }
        if (isset($data['temporary_mode_select'])) {
            $attrs['temporary_mode_select'] = strtolower((string) $data['temporary_mode_select']);
        }
        if (isset($data['temporary_mode_duration']) && is_numeric($data['temporary_mode_duration'])) {
            $attrs['temporary_mode_duration'] = (int) $data['temporary_mode_duration'];
        }
        if (isset($data['timer_mode_target_temp']) && is_numeric($data['timer_mode_target_temp'])) {
            $attrs['timer_mode_target_temp'] = round((float) $data['timer_mode_target_temp'], 1);
        }
        if (isset($data['valve_opening_degree']) && is_numeric($data['valve_opening_degree'])) {
            $attrs['valve_opening_degree'] = (int) $data['valve_opening_degree'];
        }
        if (isset($data['valve_closing_degree']) && is_numeric($data['valve_closing_degree'])) {
            $attrs['valve_closing_degree'] = (int) $data['valve_closing_degree'];
        }
        foreach (['idle_steps', 'closing_steps', 'valve_opening_limit_voltage', 'valve_closing_limit_voltage', 'valve_motor_running_voltage'] as $diagKey) {
            if (isset($data[$diagKey]) && is_numeric($data[$diagKey])) {
                $attrs[$diagKey] = (int) $data[$diagKey];
            }
        }
        foreach ([
            'weekly_schedule_sunday', 'weekly_schedule_monday', 'weekly_schedule_tuesday',
            'weekly_schedule_wednesday', 'weekly_schedule_thursday', 'weekly_schedule_friday',
            'weekly_schedule_saturday',
        ] as $schedKey) {
            if (isset($data[$schedKey]) && is_string($data[$schedKey])) {
                $attrs[$schedKey] = $data[$schedKey];
            }
        }
        // Legacy nested weekly_schedule → flache Keys
        if (isset($data['weekly_schedule']) && is_array($data['weekly_schedule'])) {
            foreach ($data['weekly_schedule'] as $day => $transitions) {
                if (is_string($day) && is_string($transitions)) {
                    $attrs['weekly_schedule_' . strtolower($day)] = $transitions;
                }
            }
        }

        // Tür-/Fensterkontakt
        if (isset($data['contact'])) {
            $status = $data['contact'] ? 'closed' : 'open';
            $updates['status'] = $status;
            $logStatus = $status;
        }

        // Strommessung
        if (isset($data['power'])) {
            $attrs['power_w'] = round((float) $data['power'], 1);
        }
        if (isset($data['energy'])) {
            $attrs['energy_wh'] = round((float) $data['energy'], 1);
        }

        // Batterie
        if (isset($data['battery'])) {
            $attrs['battery'] = (int) $data['battery'];
        }

        $updates['attributes'] = $attrs;
        $previousStatus = $device->status;
        $device->update($updates);

        $fresh = $device->fresh();
        DeviceStatusUpdated::dispatch($fresh);
        app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);

        if ($logStatus) {
            DeviceLog::create([
                'device_id'   => $device->id,
                'status'      => $logStatus,
                'value'       => $logValue,
                'recorded_at' => now(),
            ]);
        }

        $this->line("[Zigbee] {$device->name}: " . json_encode(array_intersect_key($data, array_flip(['state', 'temperature', 'humidity', 'contact', 'battery']))));
    }

    // -------------------------------------------------------------------------
    // Einfaches Topic (ESP32 / generisch)
    // -------------------------------------------------------------------------

    private function handleSimple(string $topic, string $payload): void
    {
        $device = $this->findDevice($topic);
        if (!$device) {
            return;
        }

        $value  = trim($payload);
        $status = strtolower($value);

        // Boolean
        if (in_array($status, ['on', 'off', 'true', 'false', '1', '0'])) {
            $normalized = in_array($status, ['on', 'true', '1']) ? 'on' : 'off';
            $previousStatus = $device->status;
            $device->update(['status' => $normalized, 'last_seen' => now()]);
            $fresh = $device->fresh();
            DeviceStatusUpdated::dispatch($fresh);
            app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);
            if ($normalized !== $previousStatus) {
                DeviceLog::create(['device_id' => $device->id, 'status' => $normalized, 'recorded_at' => now()]);
            }
            $this->line("[Simple] {$device->name}: {$normalized}");
            return;
        }

        // Numerischer Wert (Temperatur, Sensor etc.)
        if (is_numeric($value)) {
            $previousStatus = $device->status;
            $device->update(['status' => $value, 'last_seen' => now()]);
            $fresh = $device->fresh();
            DeviceStatusUpdated::dispatch($fresh);
            app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);
            DeviceLog::create(['device_id' => $device->id, 'status' => 'value', 'value' => $value, 'recorded_at' => now()]);
            $this->line("[Simple] {$device->name}: {$value}");
        }
    }

    // -------------------------------------------------------------------------
    // Gerät per mqtt_topic suchen
    // -------------------------------------------------------------------------

    private function findDevice(string $topic): ?Device
    {
        return Device::where('mqtt_topic', $topic)
            ->where('active', true)
            ->first();
    }
}
