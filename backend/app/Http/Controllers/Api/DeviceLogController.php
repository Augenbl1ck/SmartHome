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
        $since = now()->subHours($hours);

        $logs = DeviceLog::where('device_id', $device->id)
            ->where('recorded_at', '>=', $since)
            ->whereRaw("CAST(status AS REAL) = CAST(status AS REAL)") // nur numerische Werte
            ->orderBy('recorded_at')
            ->get(['status', 'recorded_at']);

        if ($logs->isEmpty()) {
            return response()->json([
                'readings' => [],
                'min'      => null,
                'max'      => null,
                'avg'      => null,
            ]);
        }

        // Stündliche Buckets
        $buckets = [];
        foreach ($logs as $log) {
            $hour = \Carbon\Carbon::parse($log->recorded_at)->format('Y-m-d H:00:00');
            $buckets[$hour][] = (float) $log->status;
        }

        $readings = [];
        foreach ($buckets as $hour => $values) {
            $readings[] = [
                'time'  => $hour,
                'value' => round(array_sum($values) / count($values), 1),
                'min'   => min($values),
                'max'   => max($values),
            ];
        }

        $allValues = $logs->map(fn ($l) => (float) $l->status);

        return response()->json([
            'readings' => $readings,
            'min'      => round($allValues->min(), 1),
            'max'      => round($allValues->max(), 1),
            'avg'      => round($allValues->avg(), 1),
        ]);
    }
}
