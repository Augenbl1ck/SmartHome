<?php

namespace App\Services;

/**
 * Thermostat-Capabilities (Zigbee2MQTT / TRVZB u.ä.).
 * Status-Schema: cap:<name>:<value>
 */
class ThermostatCapabilities
{
    /** MQTT JSON key pro Capability-Name */
    public const MQTT_KEYS = [
        'child_lock'                     => 'child_lock',
        'open_window'                    => 'open_window',
        'local_temperature_calibration'  => 'local_temperature_calibration',
        'frost_protection_temperature'   => 'frost_protection_temperature',
    ];

    /** Attribute die aus MQTT-State gelesen werden */
    public const INGEST_KEYS = [
        'child_lock',
        'open_window',
        'local_temperature_calibration',
        'frost_protection_temperature',
        'running_state',
        'local_temperature',
    ];

    /**
     * Parse status "cap:name:value" → [name, value] oder null.
     *
     * @return array{0: string, 1: string}|null
     */
    public static function parseCapStatus(string $status): ?array
    {
        if (!str_starts_with($status, 'cap:')) {
            return null;
        }
        $rest = substr($status, 4);
        $pos  = strpos($rest, ':');
        if ($pos === false) {
            return null;
        }
        $name  = substr($rest, 0, $pos);
        $value = substr($rest, $pos + 1);
        if ($name === '' || $value === '' || !isset(self::MQTT_KEYS[$name])) {
            return null;
        }
        return [$name, $value];
    }

    /**
     * Bau MQTT-JSON-Payload für eine Capability.
     */
    public static function mqttPayload(string $name, string $value): ?array
    {
        $key = self::MQTT_KEYS[$name] ?? null;
        if ($key === null) {
            return null;
        }

        // Typisierte Werte
        if ($name === 'local_temperature_calibration' || $name === 'frost_protection_temperature') {
            return [$key => (float) $value];
        }
        if ($name === 'open_window') {
            $v = strtoupper($value);
            return [$key => in_array($v, ['ON', 'OFF'], true) ? $v : (filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 'ON' : 'OFF')];
        }
        if ($name === 'child_lock') {
            $v = strtoupper($value);
            if (in_array($v, ['LOCK', 'UNLOCK'], true)) {
                return [$key => $v];
            }
            return [$key => filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 'LOCK' : 'UNLOCK'];
        }

        return [$key => $value];
    }

    public static function encodeCapStatus(string $name, string $value): string
    {
        return "cap:{$name}:{$value}";
    }
}
