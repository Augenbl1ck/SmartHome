<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Models\DeviceLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceLogController extends Controller
{
    public function index(Device $device): JsonResponse
    {
        $logs = DeviceLog::where('device_id', $device->id)
            ->orderByDesc('recorded_at')
            ->limit(100)
            ->get(['id', 'status', 'recorded_at']);

        return response()->json($logs);
    }

    /**
     * Sensor-Verlauf der letzten N Stunden (Default: 24h).
     * Gibt stündliche Durchschnittswerte + Tages-Min/Max zurück.
     * Nur für Sensor-Geräte (sensor_temperature, sensor_humidity).
     */
    public function sensorHistory(Request $request, Device $device): JsonResponse
    {
        $hours = min((int) $request->query('hours', 24), 168); // max 7 Tage
        $since = $request->boolean('today')
            ? now('Europe/Berlin')->startOfDay()
            : now()->subHours($hours);
        $wantHumidity = $device->type === 'sensor_humidity';

        $logs = DeviceLog::where('device_id', $device->id)
            ->where('recorded_at', '>=', $since)
            ->orderBy('recorded_at')
            ->get(['status', 'value', 'recorded_at']);

        $valuesByHour = [];
        $allValues = [];

        foreach ($logs as $log) {
            $n = $this->numericReading($log->status, $log->value, $wantHumidity);
            if ($n === null) {
                continue;
            }
            $hour = \Carbon\Carbon::parse($log->recorded_at)->format('Y-m-d H:00:00');
            $valuesByHour[$hour][] = $n;
            $allValues[] = $n;
        }

        if (!$wantHumidity) {
            $attrs = $device->extra();
            $current = $attrs['temperature'] ?? $attrs['local_temperature'] ?? (is_numeric($device->status) ? $device->status : null);
            if (is_numeric($current)) {
                $allValues[] = round((float) $current, 1);
            }
        }

        if ($allValues === []) {
            return response()->json([
                'readings' => [],
                'min'      => null,
                'max'      => null,
                'avg'      => null,
            ]);
        }

        $readings = [];
        foreach ($valuesByHour as $hour => $values) {
            $readings[] = [
                'time'  => $hour,
                'value' => round(array_sum($values) / count($values), 1),
                'min'   => min($values),
                'max'   => max($values),
            ];
        }

        return response()->json([
            'readings' => $readings,
            'min'      => round(min($allValues), 1),
            'max'      => round(max($allValues), 1),
            'avg'      => round(array_sum($allValues) / count($allValues), 1),
        ]);
    }

    private function numericReading(?string $status, ?string $value, bool $humidity): ?float
    {
        if ($humidity) {
            if ($status === 'humidity' && is_numeric($value)) {
                return (float) $value;
            }
            if (is_numeric($status) && $status !== 'humidity') {
                return (float) $status;
            }
            return null;
        }

        if (is_numeric($status)) {
            return (float) $status;
        }
        if (in_array($status, ['temperature', 'value'], true) && is_numeric($value)) {
            return (float) $value;
        }

        return null;
    }
}
