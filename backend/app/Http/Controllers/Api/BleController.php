<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class BleController extends Controller
{
    private string $bridgeUrl;

    public function __construct()
    {
        $this->bridgeUrl = config('smarthome.ble_bridge_url', 'http://localhost:3001');
    }

    /**
     * Scannt nach BLE-Geräten in der Nähe.
     * Proxied GET /scan an die BLE Bridge.
     */
    public function scan(Request $request): JsonResponse
    {
        $timeout = (int) $request->query('timeout', 8000);
        $prefix  = $request->query('prefix', 'Shelly');

        try {
            $response = Http::timeout(ceil($timeout / 1000) + 5)
                ->get("{$this->bridgeUrl}/scan", [
                    'timeout' => $timeout,
                    'prefix'  => $prefix,
                ]);

            if ($response->failed()) {
                return response()->json(
                    ['error' => 'BLE Bridge Fehler: ' . $response->body()],
                    $response->status()
                );
            }

            return response()->json($response->json());
        } catch (\Exception $e) {
            return response()->json(
                ['error' => 'BLE Bridge nicht erreichbar: ' . $e->getMessage()],
                503
            );
        }
    }

    /**
     * Speichert die MAC-Adresse direkt am Gerät.
     */
    public function saveMac(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate(['ble_address' => 'required|string|max:17']);

        $attrs = $device->attributes ?? [];
        $attrs['ble_address'] = strtoupper($data['ble_address']);
        $device->update(['attributes' => $attrs]);

        return response()->json($device);
    }

    /**
     * Sendet einen Shelly RPC-Befehl via BLE Bridge und gibt die Antwort zurück.
     * POST /devices/{device}/ble-rpc
     * Body: { method: string, params?: object }
     */
    public function rpc(Request $request, Device $device): JsonResponse
    {
        $data = $request->validate([
            'method' => 'required|string|max:100',
            'params' => 'nullable|array',
        ]);

        $bleAddress = $device->attributes['ble_address'] ?? null;
        if (!$bleAddress) {
            return response()->json(['error' => 'Keine BLE-MAC-Adresse konfiguriert'], 400);
        }

        try {
            $response = Http::timeout(20)->post("{$this->bridgeUrl}/rpc", [
                'bleAddress' => $bleAddress,
                'method'     => $data['method'],
                'params'     => $data['params'] ?? [],
            ]);

            if ($response->failed()) {
                return response()->json(
                    ['error' => 'BLE Bridge Fehler: ' . $response->body()],
                    $response->status()
                );
            }

            return response()->json($response->json());
        } catch (\Exception $e) {
            return response()->json(
                ['error' => 'BLE Bridge nicht erreichbar: ' . $e->getMessage()],
                503
            );
        }
    }
}
