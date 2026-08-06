<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ShellyRpcController extends Controller
{
    /**
     * POST /api/v1/devices/{device}/shelly-rpc
     *
     * Sendet einen RPC-Befehl direkt per HTTP an eine Shelly Gen3.
     * Benötigt device.attributes['shelly_ip'] oder nutzt {mqtt_topic}.local als Fallback.
     */
    public function rpc(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate([
            'method' => 'required|string|max:100',
            'params' => 'nullable|array',
        ]);

        $ip = $device->attributes['shelly_ip'] ?? null;
        if (!$ip) {
            // Fallback: mqtt_topic als mDNS-Hostname nutzen (z.B. shellyplugsg3-XXXX.local)
            $topic = $device->mqtt_topic ?? '';
            $ip = trim($topic, '/') . '.local';
        }

        $method = $data['method'];
        $params = $data['params'] ?? [];

        try {
            $response = Http::timeout(8)->post("http://{$ip}/rpc/{$method}", $params);

            if ($response->failed()) {
                return response()->json(['error' => 'Shelly HTTP Fehler: ' . $response->status()], 502);
            }

            return response()->json(['result' => $response->json()]);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Shelly nicht erreichbar: ' . $e->getMessage()], 503);
        }
    }
}
