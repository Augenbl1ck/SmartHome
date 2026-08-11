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
        'calendar_ical_url',
    ];

    public function show(): JsonResponse
    {
        return response()->json([
            'pin_hash'          => PanelSetting::getValue('pin_hash'),
            'pin_enabled'       => (bool) PanelSetting::getValue('pin_enabled', false),
            'lock_timeout'      => (int) PanelSetting::getValue('lock_timeout', 30),
            'screen_timeout'    => (int) PanelSetting::getValue('screen_timeout', 60),
            'kiosk_mode'        => (bool) PanelSetting::getValue('kiosk_mode', false),
            'calendar_ical_url' => PanelSetting::getValue('calendar_ical_url') ?: null,
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'pin_hash'          => 'sometimes|nullable|string|max:128',
            'pin_enabled'       => 'sometimes|boolean',
            'lock_timeout'      => 'sometimes|integer|min:0|max:86400',
            'screen_timeout'    => 'sometimes|integer|min:0|max:86400',
            'kiosk_mode'        => 'sometimes|boolean',
            'calendar_ical_url' => 'sometimes|nullable|string|max:2000',
        ]);

        if (array_key_exists('calendar_ical_url', $data) && is_string($data['calendar_ical_url'])) {
            $data['calendar_ical_url'] = trim($data['calendar_ical_url']) ?: null;
        }

        if (array_key_exists('calendar_ical_url', $data)) {
            $oldUrl = PanelSetting::getValue('calendar_ical_url');
            if (is_string($oldUrl) && $oldUrl !== '') {
                \Illuminate\Support\Facades\Cache::forget('calendar_ics_' . sha1($oldUrl));
            }
            if (is_string($data['calendar_ical_url']) && $data['calendar_ical_url'] !== '') {
                \Illuminate\Support\Facades\Cache::forget('calendar_ics_' . sha1($data['calendar_ical_url']));
            }
        }

        foreach (self::KEYS as $key) {
            if (array_key_exists($key, $data)) {
                PanelSetting::setValue($key, $data[$key]);
            }
        }

        return $this->show();
    }
}
