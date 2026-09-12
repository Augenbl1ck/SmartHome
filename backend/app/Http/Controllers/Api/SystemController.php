<?php

namespace App\Http\Controllers\Api;

use App\Services\DisplayPowerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SystemController
{
    /**
     * System-Status (CPU-Temperatur, Uptime, Memory, etc.)
     */
    public function status(): JsonResponse
    {
        $data = [
            'cpu_temp'    => $this->getCpuTemperature(),
            'uptime'      => $this->getUptime(),
            'memory_used' => $this->getMemoryUsage(),
            'disk_used'   => $this->getDiskUsage(),
        ];

        return response()->json($data);
    }

    public function setDisplay(Request $request, DisplayPowerService $display): JsonResponse
    {
        $data = $request->validate([
            'on' => 'required|boolean',
        ]);
        $display->setOn((bool) $data['on']);

        return response()->json(['ok' => true, 'on' => (bool) $data['on']]);
    }

    /**
     * Liest CPU-Temperatur vom Raspberry Pi
     */
    private function getCpuTemperature(): ?float
    {
        // Methode 1: thermal_zone0 (Milligrad Celsius)
        $file = '/sys/class/thermal/thermal_zone0/temp';
        if (file_exists($file)) {
            $temp = (float) file_get_contents($file);
            return round($temp / 1000, 1); // Umrechnen auf Grad Celsius
        }

        // Methode 2: vcgencmd (nur auf Raspberry Pi verfügbar)
        $output = shell_exec('vcgencmd measure_temp 2>/dev/null');
        if ($output && preg_match('/temp=([\d.]+)/', $output, $matches)) {
            return (float) $matches[1];
        }

        return null;
    }

    /**
     * System-Uptime in Sekunden
     */
    private function getUptime(): ?int
    {
        $file = '/proc/uptime';
        if (file_exists($file)) {
            $uptime = file_get_contents($file);
            return (int) explode(' ', $uptime)[0];
        }
        return null;
    }

    /**
     * RAM-Nutzung in Prozent
     */
    private function getMemoryUsage(): ?float
    {
        $file = '/proc/meminfo';
        if (!file_exists($file)) return null;

        $meminfo = file_get_contents($file);
        preg_match('/MemTotal:\s+(\d+)/', $meminfo, $total);
        preg_match('/MemAvailable:\s+(\d+)/', $meminfo, $available);

        if (!$total || !$available) return null;

        $totalKB = (int) $total[1];
        $availableKB = (int) $available[1];
        $usedKB = $totalKB - $availableKB;

        return round(($usedKB / $totalKB) * 100, 1);
    }

    /**
     * Disk-Nutzung in Prozent (Root-Partition)
     */
    private function getDiskUsage(): ?float
    {
        $total = disk_total_space('/');
        $free  = disk_free_space('/');

        if ($total === false || $free === false) return null;

        $used = $total - $free;
        return round(($used / $total) * 100, 1);
    }
}
