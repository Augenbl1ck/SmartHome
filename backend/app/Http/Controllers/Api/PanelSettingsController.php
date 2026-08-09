<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PanelSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PanelSettingsController extends Controller
{
    private const KEYS = [
        'pin_hash',
        'pin_enabled',
        'lock_timeout',
        'screen_timeout',
        'kiosk_mode',
    ];

    public function show(): JsonResponse
    {
        return response()->json([
            'pin_hash'        => PanelSetting::getValue('pin_hash'),
            'pin_enabled'     => (bool) PanelSetting::getValue('pin_enabled', false),
            'lock_timeout'    => (int) PanelSetting::getValue('lock_timeout', 30),
            'screen_timeout'  => (int) PanelSetting::getValue('screen_timeout', 60),
            'kiosk_mode'      => (bool) PanelSetting::getValue('kiosk_mode', false),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'pin_hash'       => 'sometimes|nullable|string|max:128',
            'pin_enabled'    => 'sometimes|boolean',
            'lock_timeout'   => 'sometimes|integer|min:0|max:86400',
            'screen_timeout' => 'sometimes|integer|min:0|max:86400',
            'kiosk_mode'     => 'sometimes|boolean',
        ]);

        foreach (self::KEYS as $key) {
            if (array_key_exists($key, $data)) {
                PanelSetting::setValue($key, $data[$key]);
            }
        }

        return $this->show();
    }
}
