<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ShellyRpcController extends Controller
{
    /**
     * POST /api/v1/devices/{device}/shelly-rpc
     *
     * Sendet einen RPC-Befehl direkt per HTTP an eine Shelly Gen3.
     * Host: attributes.shelly_ip → IPv4 im mqtt_topic → sonst {topic}.local
     */
    public function rpc(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate([
            'method' => 'required|string|max:100',
            'params' => 'nullable|array',
        ]);

        $host = $this->resolveHost($device);
        $method = $data['method'];
        $params = $data['params'] ?? [];

        try {
            $response = Http::timeout(2)->connectTimeout(2)->post("http://{$host}/rpc/{$method}", $params);

            if ($response->failed()) {
                return response()->json(['error' => 'Shelly HTTP Fehler: ' . $response->status()], 502);
            }

            return response()->json(['result' => $response->json()]);
        } catch (\Exception $e) {
            Log::warning('[Shelly RPC] ' . $device->name . ' @ ' . $host . ': ' . $e->getMessage());
            return response()->json(['error' => 'Shelly nicht erreichbar (' . $host . ')'], 503);
        }
    }

    private function resolveHost(Device $device): string
    {
        $attrs = $device->attributes ?? [];
        $ip = trim((string) ($attrs['shelly_ip'] ?? ''));
        $ip = preg_replace('#^https?://#i', '', $ip) ?? $ip;
        $ip = rtrim($ip, '/');
        if ($ip !== '') {
            return $ip;
        }

        $topic = trim((string) ($device->mqtt_topic ?? ''), '/');
        $topic = preg_replace('#^https?://#i', '', $topic) ?? $topic;
        if ($topic === '') {
            return '127.0.0.1';
        }
        $hostOnly = explode('/', $topic)[0];
        if (filter_var($hostOnly, FILTER_VALIDATE_IP)) {
            return $hostOnly;
        }
        if (str_ends_with(strtolower($hostOnly), '.local')) {
            return $hostOnly;
        }

        return $hostOnly . '.local';
    }
}
