<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\ShellyLanHost;
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
     * Host: gespeicherte IPv4, sonst mDNS/ARP aus der Geräte-ID.
     */
    public function rpc(Request $request, Device $device, ShellyLanHost $lan): JsonResponse
    {
        $data = $request->validate([
            'method' => 'required|string|max:100',
            'params' => 'nullable|array',
        ]);

        $method = $data['method'];
        $params = $data['params'] ?? [];
        $host = $lan->resolve($device);

        try {
            return $this->call($host, $method, $params);
        } catch (\Exception $e) {
            $retryHost = $lan->resolve($device, refresh: true);
            if ($retryHost !== $host) {
                try {
                    return $this->call($retryHost, $method, $params);
                } catch (\Exception $retry) {
                    $e = $retry;
                    $host = $retryHost;
                }
            }
            Log::warning('[Shelly RPC] ' . $device->name . ' @ ' . $host . ': ' . $e->getMessage());

            return response()->json(['error' => 'Shelly nicht erreichbar (' . $host . ')'], 503);
        }
    }

    /**
     * @param  array<string, mixed>  $params
     */
    private function call(string $host, string $method, array $params): JsonResponse
    {
        $response = Http::timeout(4)->connectTimeout(3)->post("http://{$host}/rpc/{$method}", $params);

        if ($response->failed()) {
            return response()->json(['error' => 'Shelly HTTP Fehler: ' . $response->status()], 502);
        }

        return response()->json(['result' => $response->json()]);
    }
}
