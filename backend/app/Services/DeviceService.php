<?php

namespace App\Services;

use App\Events\DeviceStatusUpdated;
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
    public function __construct(
        private readonly WakeOnLanService $wakeOnLan,
        private readonly ShellyLanHost $shellyLan,
    ) {}

    public function setStatus(Device $device, string $status): void
    {
        $reason = app(InterlockService::class)->blockedReason($device, $status);
        if ($reason !== null) {
            throw new DeviceCommandBlockedException($device, $status, $reason);
        }

        $protocol = $device->extra()['protocol'] ?? 'simple';

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

        $mode = strtolower($status);
        if ($device->type === 'thermostat' && in_array($mode, ['off', 'heat', 'auto', 'on'], true)) {
            $this->sendThermostatSystemMode($device, $mode === 'on' ? 'heat' : $mode);
        } else {
            match (true) {
                $protocol === 'shelly_gen3_http'      => $this->sendHttp($device, $status),
                $protocol === 'bluetooth_shelly_gen3' => $this->sendBleBridge($device, $status),
                default                               => $this->sendMqtt($device, $status),
            };
        }

        DeviceLog::create([
            'device_id'   => $device->id,
            'status'      => $status,
            'recorded_at' => now(),
        ]);

        $normalized = strtolower($status);
        if (in_array($normalized, ['on', 'off', 'heat', 'auto'], true)) {
            $device->markCommandedStatus($normalized === 'on' ? 'heat' : $normalized, 20);
        }
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

    /**
     * TRVZB ignoriert system_mode oft, solange Boost/Timer läuft.
     * Beim Aus: zuerst Dauer 0, dann off — in einem Payload, Reihenfolge zählt.
     * Wunsch-Sollwert bleibt erhalten: im Aus-Modus meldet das Ventil sonst Frostschutz (4–7 °C).
     */
    private function sendThermostatSystemMode(Device $device, string $mode): void
    {
        $attrs = $device->extra();
        if ($mode === 'off') {
            $this->rememberComfortSetpoint($attrs);
            $attrs['temporary_mode_duration'] = 0;
            $attrs['temporary_mode_select'] = '';
            $attrs['temporary_mode_until'] = null;
            $attrs['running_state'] = 'idle';
            $device->update(['attributes' => $attrs]);
            $this->publishMqttJson($device, [
                'temporary_mode_duration' => 0,
                'system_mode' => 'off',
            ]);

            return;
        }

        $comfort = $this->comfortSetpoint($attrs);
        if ($mode === 'auto' && $comfort !== null) {
            $schedule = $this->pinComfortOnTodaySchedule($attrs, $comfort);
            if ($schedule !== null) {
                $this->publishMqttJson($device, $schedule);
            }
        }
        $this->publishMqttJson($device, ['system_mode' => $mode]);
        if ($comfort !== null) {
            $this->publishMqttJson($device, ['occupied_heating_setpoint' => $comfort]);
            $attrs['setpoint'] = $comfort;
            $attrs['comfort_setpoint'] = $comfort;
            $device->update(['attributes' => $attrs]);
        }
    }

    /**
     * Auto folgt dem Wochenplan. Ohne Anpassung springt der TRVZB auf den Plan (oft 19 °C).
     *
     * @param  array<string, mixed>  $attrs
     * @return array<string, string>|null
     */
    private function pinComfortOnTodaySchedule(array &$attrs, float $comfort): ?array
    {
        $day = strtolower(now()->format('l'));
        $key = 'weekly_schedule_'.$day;
        $temp = number_format($comfort, 1, '.', '');
        $raw = isset($attrs[$key]) && is_string($attrs[$key]) ? trim($attrs[$key]) : '';
        if ($raw === '') {
            $next = '00:00/'.$temp;
            $attrs[$key] = $next;

            return [$key => $next];
        }

        $parts = preg_split('/\s+/', $raw) ?: [];
        $slots = [];
        foreach ($parts as $part) {
            if (! preg_match('/^(\d{1,2}:\d{2})\/(-?\d+(?:\.\d+)?)$/', $part, $m)) {
                continue;
            }
            $slots[] = [$m[1], (float) $m[2]];
        }
        if ($slots === []) {
            $next = '00:00/'.$temp;
            $attrs[$key] = $next;

            return [$key => $next];
        }

        $now = now()->format('H:i');
        $active = 0;
        foreach ($slots as $i => [$time]) {
            if ($time <= $now) {
                $active = $i;
            }
        }
        $slots[$active][1] = $comfort;
        $next = implode(' ', array_map(
            fn (array $slot) => $slot[0].'/'.number_format($slot[1], 1, '.', ''),
            $slots,
        ));
        $attrs[$key] = $next;

        return [$key => $next];
    }

    /**
     * MQTT-Sollwert übernehmen, ohne den Frostschutz im Aus-Modus als Wunschtemperatur zu speichern.
     *
     * @param  array<string, mixed>  $attrs
     * @return array<string, mixed>
     */
    public function applyReportedSetpoint(array $attrs, ?string $mode, ?float $occupied, ?float $current): array
    {
        if ($current !== null) {
            $attrs['current_heating_setpoint'] = round($current, 1);
        }
        if ($occupied === null) {
            return $attrs;
        }

        $occupied = round($occupied, 1);
        $attrs['reported_occupied_setpoint'] = $occupied;
        $off = strtolower((string) $mode) === 'off';
        if ($this->isFrostSetpoint($attrs, $occupied)) {
            $comfort = isset($attrs['comfort_setpoint']) && is_numeric($attrs['comfort_setpoint'])
                ? (float) $attrs['comfort_setpoint']
                : null;
            if ($off || ($comfort !== null && $comfort > $occupied + 0.6)) {
                return $attrs;
            }
        }

        $attrs['setpoint'] = $occupied;
        if (strtolower((string) $mode) !== 'auto') {
            $attrs['comfort_setpoint'] = $occupied;
        }

        return $attrs;
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function rememberComfortSetpoint(array &$attrs): void
    {
        if (! isset($attrs['setpoint']) || ! is_numeric($attrs['setpoint'])) {
            return;
        }
        $setpoint = round((float) $attrs['setpoint'], 1);
        if ($this->isFrostSetpoint($attrs, $setpoint)) {
            return;
        }
        $attrs['comfort_setpoint'] = $setpoint;
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function comfortSetpoint(array $attrs): ?float
    {
        foreach (['comfort_setpoint', 'setpoint'] as $key) {
            if (! isset($attrs[$key]) || ! is_numeric($attrs[$key])) {
                continue;
            }
            $value = round((float) $attrs[$key], 1);
            if (! $this->isFrostSetpoint($attrs, $value)) {
                return $value;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function isFrostSetpoint(array $attrs, float $value): bool
    {
        $frost = $attrs['frost_protection_temperature'] ?? null;
        $limit = is_numeric($frost) ? (float) $frost : 7.0;

        return $value <= $limit + 0.6;
    }

    // -------------------------------------------------------------------------
    // HTTP (Shelly Gen3 LAN)
    // -------------------------------------------------------------------------

    private function sendHttp(Device $device, string $status): void
    {
        $host = $this->shellyLan->resolve($device);
        $url = "http://{$host}/rpc/Switch.Set";
        $body = ['id' => 0, 'on' => $status === 'on'];

        try {
            $response = Http::timeout(4)->connectTimeout(3)->post($url, $body);
            if (! $response->successful()) {
                throw new \RuntimeException("HTTP {$response->status()} bei {$device->name}");
            }
        } catch (\RuntimeException $e) {
            throw $e;
        } catch (\Exception $first) {
            $retryHost = $this->shellyLan->resolve($device, refresh: true);
            if ($retryHost === $host) {
                throw new \RuntimeException("HTTP nicht erreichbar {$device->name}: " . $first->getMessage(), 0, $first);
            }
            try {
                $response = Http::timeout(4)->connectTimeout(3)->post("http://{$retryHost}/rpc/Switch.Set", $body);
                if (! $response->successful()) {
                    throw new \RuntimeException("HTTP {$response->status()} bei {$device->name}");
                }
            } catch (\RuntimeException $e) {
                throw $e;
            } catch (\Exception $e) {
                throw new \RuntimeException("HTTP nicht erreichbar {$device->name}: " . $e->getMessage(), 0, $e);
            }
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
                throw new \RuntimeException('BLE Bridge Fehler bei ' . $device->name);
            }
        } catch (\RuntimeException $e) {
            throw $e;
        } catch (\Exception $e) {
            throw new \RuntimeException('BLE Bridge nicht erreichbar: ' . $e->getMessage(), 0, $e);
        }
    }

    // -------------------------------------------------------------------------
    // MQTT (Shelly Gen1, Gen3 MQTT, simple)
    // -------------------------------------------------------------------------

    private function sendMqtt(Device $device, string $status): void
    {
        if (!$device->mqtt_topic) {
            throw new \RuntimeException("Kein MQTT-Topic für {$device->name}");
        }

        $protocol = $device->extra()['protocol'] ?? 'simple';
        [$topic, $payload] = $this->buildMqttCommand($device, $protocol, $status);

        try {
            $mqtt = new MqttClient(
                config('mqtt.host', '127.0.0.1'),
                (int) config('mqtt.port', 1883),
                'laravel-ds-' . uniqid()
            );
            $mqtt->connect(MqttHelper::settings(3), true);
            $qos = $protocol === 'zigbee2mqtt' ? 1 : 0;
            $mqtt->publish($topic, $payload, $qos);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            throw new \RuntimeException("[DeviceService] MQTT nicht verfügbar: " . $e->getMessage(), 0, $e);
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
        $attrsPatch = [];

        switch ($type) {
            case 'boost':
                $duration = max(1, min(180, (int) ($command['duration'] ?? 30)));
                $restore = $this->captureBoostRestore($device);
                // TRVZB: Dauer VOR dem Modus schreiben, sonst startet Boost ohne Timer.
                $this->publishMqttJson($device, ['temporary_mode_duration' => $duration]);
                $this->publishMqttJson($device, ['temporary_mode_select' => 'boost']);
                $attrsPatch = array_merge($restore, [
                    'temporary_mode_select'   => 'boost',
                    'temporary_mode_duration' => $duration,
                    'temporary_mode_until'    => now()->addMinutes($duration)->toIso8601String(),
                ]);
                break;

            case 'timer':
                $duration = max(1, min(1440, (int) ($command['duration'] ?? 60)));
                $temp = round((float) ($command['temperature'] ?? 21), 1);
                $temp = max(4.0, min(35.0, $temp));
                $restore = $this->captureBoostRestore($device);
                $this->publishMqttJson($device, ['temporary_mode_duration' => $duration]);
                $this->publishMqttJson($device, ['timer_mode_target_temp' => $temp]);
                $this->publishMqttJson($device, ['temporary_mode_select' => 'timer']);
                $attrsPatch = array_merge($restore, [
                    'temporary_mode_select'   => 'timer',
                    'temporary_mode_duration' => $duration,
                    'temporary_mode_until'    => now()->addMinutes($duration)->toIso8601String(),
                    'timer_mode_target_temp'  => $temp,
                ]);
                break;

            case 'clear_boost':
                $attrsPatch = $this->clearTemporaryMode($device);
                break;

            default:
                throw new \InvalidArgumentException('Unbekannter Thermostat-Befehl');
        }

        DeviceLog::create([
            'device_id'   => $device->id,
            'status'      => 'thermostat:' . $type,
            'recorded_at' => now(),
        ]);

        return $attrsPatch;
    }

    /**
     * Boost/Timer beenden: Dauer 0 + alte Solltemperatur (sonst bleibt 35 °C).
     *
     * @return array<string, mixed>
     */
    public function clearTemporaryMode(Device $device): array
    {
        $attrs = $device->extra();
        $setpoint = $this->restoreSetpointFrom($attrs);
        $mode = $this->restoreSystemModeFrom($attrs);

        $this->publishMqttJson($device, ['temporary_mode_duration' => 0]);
        $this->publishMqttJson($device, [
            'occupied_heating_setpoint' => $setpoint,
            'system_mode' => $mode,
        ]);

        return [
            'temporary_mode_duration' => 0,
            'temporary_mode_select'   => '',
            'temporary_mode_until'    => null,
            'setpoint'                => $setpoint,
        ];
    }

    public function expireTemporaryModes(): int
    {
        $n = 0;
        Device::query()
            ->where('type', 'thermostat')
            ->where('active', true)
            ->get()
            ->each(function (Device $device) use (&$n) {
                $until = $device->extra()['temporary_mode_until'] ?? null;
                if (! is_string($until) || $until === '') {
                    return;
                }
                $ts = strtotime($until);
                if ($ts === false || $ts > time()) {
                    return;
                }
                try {
                    $patch = $this->clearTemporaryMode($device);
                } catch (\Throwable $e) {
                    Log::warning('[Thermostat] Boost-Ende '.$device->name.': '.$e->getMessage());

                    return;
                }
                $device->update(['attributes' => array_merge($device->extra(), $patch)]);
                $fresh = $device->fresh();
                if ($fresh) {
                    DeviceStatusUpdated::dispatch($fresh);
                }
                $n++;
            });

        return $n;
    }

    /**
     * @return array{boost_restore_setpoint: float, boost_restore_system_mode: string}
     */
    private function captureBoostRestore(Device $device): array
    {
        $attrs = $device->extra();
        $alreadyOn = (int) ($attrs['temporary_mode_duration'] ?? 0) > 0
            && ! empty($attrs['temporary_mode_until']);
        if ($alreadyOn && isset($attrs['boost_restore_setpoint'])) {
            return [
                'boost_restore_setpoint' => (float) $attrs['boost_restore_setpoint'],
                'boost_restore_system_mode' => $this->restoreSystemModeFrom($attrs),
            ];
        }
        $setpoint = (float) ($attrs['setpoint'] ?? 20);
        if ($setpoint < 4 || $setpoint > 33) {
            $setpoint = 20.0;
        }
        $mode = strtolower((string) ($attrs['system_mode'] ?? $device->status ?? 'heat'));
        if (! in_array($mode, ['off', 'auto', 'heat'], true)) {
            $mode = 'heat';
        }

        return [
            'boost_restore_setpoint' => $setpoint,
            'boost_restore_system_mode' => $mode,
        ];
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function restoreSetpointFrom(array $attrs): float
    {
        $sp = $attrs['boost_restore_setpoint'] ?? $attrs['setpoint'] ?? 20;
        $sp = is_numeric($sp) ? (float) $sp : 20.0;
        if ($sp < 4 || $sp > 33) {
            return 20.0;
        }

        return round($sp, 1);
    }

    /**
     * @param  array<string, mixed>  $attrs
     */
    private function restoreSystemModeFrom(array $attrs): string
    {
        $mode = strtolower((string) ($attrs['boost_restore_system_mode'] ?? $attrs['system_mode'] ?? 'heat'));

        return in_array($mode, ['off', 'auto', 'heat'], true) ? $mode : 'heat';
    }

    public function sensorTemperature(Device $device): ?float
    {
        $attrs = $device->extra();
        foreach (['temperature', 'local_temperature'] as $key) {
            if (isset($attrs[$key]) && is_numeric($attrs[$key])) {
                return round((float) $attrs[$key], 1);
            }
        }
        if (is_numeric($device->status)) {
            return round((float) $device->status, 1);
        }

        return null;
    }

    /**
     * Schreibt die Raumfühler-Temperatur an den TRVZB (external_temperature_input).
     */
    public function syncExternalTemperature(Device $thermostat, ?float $celsius = null): bool
    {
        if ($thermostat->type !== 'thermostat') {
            return false;
        }
        $sourceId = (int) ($thermostat->extra()['temperature_source_device_id'] ?? 0);
        if ($sourceId < 1) {
            return false;
        }
        if ($celsius === null) {
            $sensor = Device::find($sourceId);
            if (! $sensor) {
                return false;
            }
            $celsius = $this->sensorTemperature($sensor);
        }
        if ($celsius === null) {
            return false;
        }
        $celsius = max(0.0, min(99.9, round($celsius, 1)));

        try {
            $this->publishMqttJson($thermostat, [
                'temperature_sensor_select' => 'external',
                'external_temperature_input' => $celsius,
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::warning("[DeviceService] Externe Temperatur {$thermostat->name}: ".$e->getMessage());

            return false;
        }
    }

    public function syncThermostatsFromSensor(Device $sensor, ?float $celsius = null): void
    {
        $celsius ??= $this->sensorTemperature($sensor);
        if ($celsius === null) {
            return;
        }
        Device::query()
            ->where('type', 'thermostat')
            ->where('active', true)
            ->get()
            ->each(function (Device $thermostat) use ($sensor, $celsius) {
                if ((int) ($thermostat->extra()['temperature_source_device_id'] ?? 0) === (int) $sensor->id) {
                    $this->syncExternalTemperature($thermostat, $celsius);
                }
            });
    }

    public function useInternalTemperature(Device $thermostat): void
    {
        if ($thermostat->type !== 'thermostat') {
            return;
        }
        try {
            $this->publishMqttJson($thermostat, ['temperature_sensor_select' => 'internal']);
        } catch (\Throwable $e) {
            Log::warning("[DeviceService] Interner Fühler {$thermostat->name}: ".$e->getMessage());
        }
    }

    public function syncAllExternalThermostats(): int
    {
        $count = 0;
        Device::query()
            ->where('type', 'thermostat')
            ->where('active', true)
            ->get()
            ->each(function (Device $thermostat) use (&$count) {
                if ($this->syncExternalTemperature($thermostat)) {
                    $count++;
                }
            });

        return $count;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function publishMqttJson(Device $device, array $payload, string $suffix = 'set'): void
    {
        if (!$device->mqtt_topic) {
            throw new \RuntimeException("Kein MQTT-Topic für {$device->name}");
        }

        $suffix = $suffix === 'get' ? 'get' : 'set';
        $base = rtrim((string) $device->mqtt_topic, '/');
        $topic = $base . '/' . $suffix;
        $json = json_encode($payload);

        try {
            $mqtt = new MqttClient(
                config('mqtt.host', '127.0.0.1'),
                (int) config('mqtt.port', 1883),
                'laravel-ds-json-' . uniqid()
            );
            $mqtt->connect(MqttHelper::settings(3), true);
            $mqtt->publish($topic, $json, 1);
            $mqtt->disconnect();
        } catch (\Exception $e) {
            throw new \RuntimeException("[DeviceService] MQTT nicht verfügbar: " . $e->getMessage(), 0, $e);
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

    /**
     * Nous/Zigbee-LED: nachts aus, tagsüber gespeicherter Modus.
     * Das Gerät hat keinen Helligkeits-Nachtmodus — Steuerung über den Minuten-Scheduler.
     */
    public function applyLedNightMode(Device $device): void
    {
        $attrs = $device->extra();
        if (($attrs['protocol'] ?? null) !== 'zigbee2mqtt') {
            return;
        }

        $dayMode = $attrs['led_day_mode'] ?? $attrs['indicator_mode'] ?? null;
        if (!is_string($dayMode) || $dayMode === '') {
            return;
        }

        $nightOn = filter_var($attrs['led_night_enable'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $from = $this->normalizeHm((string) ($attrs['led_night_from'] ?? '22:00')) ?? '22:00';
        $to = $this->normalizeHm((string) ($attrs['led_night_to'] ?? '06:00')) ?? '06:00';

        $desired = ($nightOn && $this->isInTimeWindow($from, $to)) ? 'off' : $dayMode;
        $current = (string) ($attrs['indicator_mode'] ?? '');
        if ($current === $desired) {
            return;
        }

        $this->publishMqttJson($device, ['indicator_mode' => $desired]);
        $attrs['indicator_mode'] = $desired;
        $device->update([
            'attributes' => $attrs,
            'last_seen' => now(),
        ]);
    }

    public function applyAllZigbeeLedNightModes(): void
    {
        Device::query()->where('type', 'plug')->get()->each(function (Device $device) {
            $attrs = $device->extra();
            if (($attrs['protocol'] ?? null) !== 'zigbee2mqtt') {
                return;
            }
            if (!filter_var($attrs['led_night_enable'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                return;
            }
            $this->applyLedNightMode($device);
        });
    }

    private function isInTimeWindow(string $from, string $to): bool
    {
        $fromM = $this->hmToMinutes($from);
        $toM = $this->hmToMinutes($to);
        if ($fromM === null || $toM === null || $fromM === $toM) {
            return false;
        }
        $cur = ((int) now()->format('G')) * 60 + (int) now()->format('i');
        if ($fromM < $toM) {
            return $cur >= $fromM && $cur < $toM;
        }

        return $cur >= $fromM || $cur < $toM;
    }

    private function hmToMinutes(string $hm): ?int
    {
        $norm = $this->normalizeHm($hm);
        if ($norm === null) {
            return null;
        }
        [$h, $m] = array_map('intval', explode(':', $norm));

        return $h * 60 + $m;
    }

    private function normalizeHm(string $value): ?string
    {
        if (preg_match('/^(\d{1,2}):(\d{2})/', $value, $m) !== 1) {
            return null;
        }
        $h = (int) $m[1];
        $min = (int) $m[2];
        if ($h > 23 || $min > 59) {
            return null;
        }

        return sprintf('%02d:%02d', $h, $min);
    }
}
