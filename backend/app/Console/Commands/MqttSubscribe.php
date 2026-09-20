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

    /** @var array<string, string> topic → Fingerprint */
    private array $lastZigbeeFp = [];

    /** @var array<int, float> deviceId → microtime der letzten Broadcast */
    private array $lastBroadcastAt = [];

    /** @var array<int, float> deviceId → letzte Leistung, bei der Automationen liefen */
    private array $lastAutomationPower = [];

    private const BROADCAST_MIN_INTERVAL = 3.0;

    private const POWER_AUTOMATION_DELTA = 15.0;

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

        $device->refresh();
        $status = $on ? 'on' : 'off';
        $previousStatus = $device->status;
        $ignoreStatus = $device->shouldIgnoreReportedStatus($status);
        if ($ignoreStatus) {
            $status = $previousStatus;
        }
        $statusChanged = ! $ignoreStatus && $status !== $previousStatus;
        $powerW = $power !== null ? round((float) $power, 1) : null;

        $attrs = $device->extra();
        if ($powerW !== null) {
            $attrs['power_w'] = $powerW;
        }
        if ($energy !== null) {
            $attrs['energy_wh'] = round($energy, 1);
        }
        if (! $ignoreStatus) {
            $attrs = $device->attributesWithoutCommandHoldIfConfirmed($attrs, $status);
        }

        $update = [
            'attributes' => $attrs,
            'last_seen'  => now(),
        ];
        if (! $ignoreStatus) {
            $update['status'] = $status;
        }
        $device->update($update);

        $fresh = $device->fresh();
        $this->broadcastDevice($fresh, $statusChanged);
        if ($this->shouldRunAutomations($fresh, $previousStatus, $powerW)) {
            app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);
        }

        if ($statusChanged) {
            DeviceLog::create([
                'device_id'   => $device->id,
                'status'      => $status,
                'value'       => $powerW !== null ? (string) $powerW : null,
                'recorded_at' => now(),
            ]);
            $this->line("[Shelly] {$device->name}: {$status}" . ($powerW !== null ? " ({$powerW} W)" : ''));
        }
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
        $data = json_decode($payload, true);
        if (!is_array($data)) {
            return;
        }

        $fp = $this->zigbeeFingerprint($data);
        if (($this->lastZigbeeFp[$topic] ?? null) === $fp) {
            return;
        }
        $this->lastZigbeeFp[$topic] = $fp;

        $device = $this->findDevice($topic);
        if (!$device) {
            return;
        }

        $oldAttrs = $device->extra();
        $updates = ['last_seen' => now()];
        $attrs   = $oldAttrs;
        $logStatus = null;
        $logValue  = null;
        $isThermostat = $device->type === 'thermostat';

        // Schalter / Steckdose — nicht für Thermostate (die nutzen system_mode)
        if (!$isThermostat && isset($data['state'])) {
            $status = strtolower($data['state']) === 'on' ? 'on' : 'off';
            $updates['status'] = $status;
            $logStatus = $status;
        }

        // Temperatursensor — nicht bei Thermostaten (die nutzen local_temperature / system_mode)
        if (!$isThermostat && isset($data['temperature'])) {
            $temp = round((float) $data['temperature'], 1);
            $updates['status'] = (string) $temp;
            $attrs['temperature'] = $temp;
            $logValue = (string) $temp;
            $logStatus = (string) $temp;
        } elseif ($isThermostat && isset($data['temperature']) && !isset($data['local_temperature'])) {
            $attrs['local_temperature'] = round((float) $data['temperature'], 1);
            $attrs['temperature'] = $attrs['local_temperature'];
        }

        // Luftfeuchtigkeit
        if (isset($data['humidity'])) {
            $attrs['humidity'] = round((float) $data['humidity'], 1);
        }
        if (isset($data['pi_heating_demand']) && is_numeric($data['pi_heating_demand'])) {
            $attrs['pi_heating_demand'] = (int) $data['pi_heating_demand'];
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
        if (isset($data['temperature_sensor_select']) && is_string($data['temperature_sensor_select'])) {
            $attrs['temperature_sensor_select'] = strtolower($data['temperature_sensor_select']);
        }
        if (isset($data['external_temperature_input']) && is_numeric($data['external_temperature_input'])) {
            $attrs['external_temperature_input'] = round((float) $data['external_temperature_input'], 1);
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
            if ($attrs['temporary_mode_duration'] <= 0) {
                $attrs['temporary_mode_until'] = null;
            }
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
        if (isset($data['voltage']) && is_numeric($data['voltage'])) {
            $attrs['voltage'] = round((float) $data['voltage'], 1);
        }
        if (isset($data['current']) && is_numeric($data['current'])) {
            $attrs['current'] = round((float) $data['current'], 3);
        }

        // Stecker-Einstellungen (Nous A1Z u. a.)
        if (isset($data['indicator_mode']) && is_string($data['indicator_mode'])) {
            $attrs['indicator_mode'] = $data['indicator_mode'];
        }
        if (isset($data['power_outage_memory']) && is_string($data['power_outage_memory'])) {
            $attrs['power_outage_memory'] = $data['power_outage_memory'];
        }
        if (isset($data['countdown']) && is_numeric($data['countdown'])) {
            $attrs['countdown'] = (int) $data['countdown'];
        }
        if (isset($data['switch_type_button']) && is_string($data['switch_type_button'])) {
            $attrs['switch_type_button'] = $data['switch_type_button'];
        }

        // Batterie
        if (isset($data['battery'])) {
            $attrs['battery'] = (int) $data['battery'];
        }

        $dayTemp = null;
        if (isset($attrs['temperature']) && is_numeric($attrs['temperature'])) {
            $dayTemp = (float) $attrs['temperature'];
        } elseif (isset($attrs['local_temperature']) && is_numeric($attrs['local_temperature'])) {
            $dayTemp = (float) $attrs['local_temperature'];
        }
        if ($dayTemp !== null) {
            $this->updateDailyTempStats($device->id, $attrs, $dayTemp);
        }

        $device->refresh();
        $previousStatus = $device->status;
        $ignoreStatus = isset($updates['status']) && $device->shouldIgnoreReportedStatus((string) $updates['status']);
        if ($ignoreStatus) {
            unset($updates['status']);
        }
        $attrs = array_merge($device->extra(), $attrs);
        if (! $ignoreStatus && isset($updates['status'])) {
            $attrs = $device->attributesWithoutCommandHoldIfConfirmed($attrs, (string) $updates['status']);
        }
        $updates['attributes'] = $attrs;
        $statusChanged = isset($updates['status']) && $updates['status'] !== $previousStatus;
        $powerW = isset($attrs['power_w']) && is_numeric($attrs['power_w']) ? (float) $attrs['power_w'] : null;
        $tempChanged = array_key_exists('temperature', $attrs)
            && ($oldAttrs['temperature'] ?? null) !== ($attrs['temperature'] ?? null);
        $device->update($updates);

        if (! $isThermostat && $tempChanged) {
            $celsius = isset($attrs['temperature']) && is_numeric($attrs['temperature'])
                ? (float) $attrs['temperature']
                : null;
            if ($celsius !== null) {
                app(\App\Services\DeviceService::class)->syncThermostatsFromSensor($device, $celsius);
            }
        }

        $fresh = $device->fresh();
        $sensorChanged = $this->sensorAttrsChanged($oldAttrs, $attrs);
        $this->broadcastDevice($fresh, $statusChanged || $sensorChanged);
        if ($statusChanged || $sensorChanged || $this->shouldRunAutomations($fresh, $previousStatus, $powerW)) {
            app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);
        }

        if ($logStatus && ($statusChanged || $tempChanged)) {
            DeviceLog::create([
                'device_id'   => $device->id,
                'status'      => $logStatus,
                'value'       => $logValue,
                'recorded_at' => now(),
            ]);
            $this->line("[Zigbee] {$device->name}: " . json_encode(array_intersect_key($data, array_flip(['state', 'temperature', 'humidity', 'contact', 'battery']))));
        }
        if (isset($attrs['humidity']) && (($oldAttrs['humidity'] ?? null) !== ($attrs['humidity'] ?? null))) {
            DeviceLog::create([
                'device_id'   => $device->id,
                'status'      => 'humidity',
                'value'       => (string) $attrs['humidity'],
                'recorded_at' => now(),
            ]);
        }
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
            $device->refresh();
            $previousStatus = $device->status;
            if ($device->shouldIgnoreReportedStatus($normalized)) {
                $device->update(['last_seen' => now()]);
                return;
            }
            if ($normalized === $previousStatus) {
                $attrs = $device->attributesWithoutCommandHoldIfConfirmed($device->extra(), $normalized);
                $device->update(['attributes' => $attrs, 'last_seen' => now()]);
                return;
            }
            $attrs = $device->attributesWithoutCommandHoldIfConfirmed($device->extra(), $normalized);
            $device->update(['status' => $normalized, 'attributes' => $attrs, 'last_seen' => now()]);
            $fresh = $device->fresh();
            $this->broadcastDevice($fresh, true);
            app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);
            DeviceLog::create(['device_id' => $device->id, 'status' => $normalized, 'recorded_at' => now()]);
            $this->line("[Simple] {$device->name}: {$normalized}");
            return;
        }

        // Numerischer Wert (Temperatur, Sensor etc.)
        if (is_numeric($value)) {
            $previousStatus = $device->status;
            if ((string) $value === (string) $previousStatus) {
                $device->update(['last_seen' => now()]);
                return;
            }
            $device->update(['status' => $value, 'last_seen' => now()]);
            $fresh = $device->fresh();
            if ($fresh && str_starts_with($fresh->type, 'sensor_')) {
                app(\App\Services\DeviceService::class)->syncThermostatsFromSensor($fresh, (float) $value);
            }
            $this->broadcastDevice($fresh, true);
            app(AutomationEngine::class)->onDeviceUpdated($fresh, $previousStatus);
            DeviceLog::create(['device_id' => $device->id, 'status' => 'value', 'value' => $value, 'recorded_at' => now()]);
            $this->line("[Simple] {$device->name}: {$value}");
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function zigbeeFingerprint(array $data): string
    {
        return json_encode([
            'state' => $data['state'] ?? null,
            'temperature' => isset($data['temperature']) ? round((float) $data['temperature'], 1) : null,
            'humidity' => isset($data['humidity']) ? round((float) $data['humidity'], 1) : null,
            'contact' => $data['contact'] ?? null,
            'system_mode' => $data['system_mode'] ?? null,
            'occupied_heating_setpoint' => isset($data['occupied_heating_setpoint']) ? round((float) $data['occupied_heating_setpoint'], 1) : null,
            'current_heating_setpoint' => isset($data['current_heating_setpoint']) ? round((float) $data['current_heating_setpoint'], 1) : null,
            'power' => isset($data['power']) ? (int) round((float) $data['power']) : null,
            'child_lock' => $data['child_lock'] ?? null,
            'indicator_mode' => $data['indicator_mode'] ?? null,
            'local_temperature' => isset($data['local_temperature']) ? round((float) $data['local_temperature'], 1) : null,
            'running_state' => $data['running_state'] ?? null,
            'temporary_mode_select' => $data['temporary_mode_select'] ?? null,
            'temporary_mode_duration' => $data['temporary_mode_duration'] ?? null,
            'pi_heating_demand' => $data['pi_heating_demand'] ?? null,
            'open_window' => $data['open_window'] ?? null,
            'battery' => $data['battery'] ?? null,
            'energy' => isset($data['energy']) ? round((float) $data['energy'], 1) : null,
            'valve_opening_degree' => $data['valve_opening_degree'] ?? null,
            'frost_protection_temperature' => $data['frost_protection_temperature'] ?? null,
            'timer_mode_target_temp' => $data['timer_mode_target_temp'] ?? null,
        ]);
    }

    /**
     * @param  array<string, mixed>  $old
     * @param  array<string, mixed>  $new
     */
    private function sensorAttrsChanged(array $old, array $new): bool
    {
        foreach (['temperature', 'humidity', 'local_temperature', 'running_state', 'setpoint', 'open_window', 'child_lock', 'pi_heating_demand', 'battery', 'temperature_min_today', 'temperature_max_today', 'temperature_stats_date'] as $key) {
            if (($old[$key] ?? null) !== ($new[$key] ?? null)) {
                return true;
            }
        }

        return false;
    }

    private function shouldRunAutomations(Device $device, string $previousStatus, ?float $powerW): bool
    {
        if ($device->status !== $previousStatus) {
            if ($powerW !== null) {
                $this->lastAutomationPower[$device->id] = $powerW;
            }

            return true;
        }
        if ($powerW === null) {
            return false;
        }
        $prev = $this->lastAutomationPower[$device->id] ?? null;
        if ($prev === null || abs($powerW - $prev) >= self::POWER_AUTOMATION_DELTA) {
            $this->lastAutomationPower[$device->id] = $powerW;

            return true;
        }

        return false;
    }

    private function broadcastDevice(?Device $device, bool $force): void
    {
        if (!$device) {
            return;
        }
        $now = microtime(true);
        $last = $this->lastBroadcastAt[$device->id] ?? 0.0;
        if (!$force && ($now - $last) < self::BROADCAST_MIN_INTERVAL) {
            return;
        }
        $this->lastBroadcastAt[$device->id] = $now;
        DeviceStatusUpdated::dispatch($device);
    }

    /**
     * Min/Max-Temperatur seit Mitternacht (Europe/Berlin) am Geräte-Attribut halten.
     *
     * @param  array<string, mixed>  $attrs
     */
    private function updateDailyTempStats(int $deviceId, array &$attrs, float $temp): void
    {
        $temp = round($temp, 1);
        $today = now('Europe/Berlin')->toDateString();
        if (($attrs['temperature_stats_date'] ?? null) !== $today) {
            $values = [$temp];
            $logs = DeviceLog::where('device_id', $deviceId)
                ->where('recorded_at', '>=', now('Europe/Berlin')->startOfDay())
                ->get(['status', 'value']);
            foreach ($logs as $log) {
                $n = $this->numericTempFromLog($log->status, $log->value);
                if ($n !== null) {
                    $values[] = $n;
                }
            }
            $attrs['temperature_stats_date'] = $today;
            $attrs['temperature_min_today'] = round(min($values), 1);
            $attrs['temperature_max_today'] = round(max($values), 1);

            return;
        }

        $min = isset($attrs['temperature_min_today']) && is_numeric($attrs['temperature_min_today'])
            ? (float) $attrs['temperature_min_today']
            : $temp;
        $max = isset($attrs['temperature_max_today']) && is_numeric($attrs['temperature_max_today'])
            ? (float) $attrs['temperature_max_today']
            : $temp;
        $attrs['temperature_min_today'] = round(min($min, $temp), 1);
        $attrs['temperature_max_today'] = round(max($max, $temp), 1);
    }

    private function numericTempFromLog(?string $status, ?string $value): ?float
    {
        if ($status === 'humidity') {
            return null;
        }
        if (is_numeric($status)) {
            return round((float) $status, 1);
        }
        if (in_array($status, ['temperature', 'value'], true) && is_numeric($value)) {
            return round((float) $value, 1);
        }

        return null;
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
