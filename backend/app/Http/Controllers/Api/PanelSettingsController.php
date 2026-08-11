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
        'dashboard_layout',
        'weather',
        'theme',
        'favorites',
        'scene_snapshots',
    ];

    public function show(): JsonResponse
    {
        return response()->json($this->payload());
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
            'dashboard_layout'  => 'sometimes|nullable|array',
            'weather'           => 'sometimes|nullable|array',
            'weather.city'      => 'sometimes|nullable|string|max:120',
            'weather.unit'      => 'sometimes|nullable|string|in:metric,imperial',
            'theme'             => 'sometimes|nullable|string|in:light,dark,system',
            'favorites'         => 'sometimes|nullable|array',
            'favorites.*'       => 'integer',
            'scene_snapshots'   => 'sometimes|nullable|array',
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

        if (array_key_exists('weather', $data) && is_array($data['weather'])) {
            $data['weather'] = [
                'city' => isset($data['weather']['city']) ? trim((string) $data['weather']['city']) : '',
                'unit' => ($data['weather']['unit'] ?? 'metric') === 'imperial' ? 'imperial' : 'metric',
            ];
            $oldWeather = PanelSetting::getValue('weather');
            if (is_array($oldWeather)) {
                $oldCity = trim((string) ($oldWeather['city'] ?? ''));
                $oldUnit = ($oldWeather['unit'] ?? '') === 'imperial' ? 'imperial' : 'metric';
                \Illuminate\Support\Facades\Cache::forget('weather_full_' . sha1($oldCity . '|' . $oldUnit));
            }
            \Illuminate\Support\Facades\Cache::forget(
                'weather_full_' . sha1($data['weather']['city'] . '|' . $data['weather']['unit'])
            );
        }

        if (array_key_exists('favorites', $data) && is_array($data['favorites'])) {
            $data['favorites'] = array_values(array_unique(array_map('intval', $data['favorites'])));
        }

        foreach (self::KEYS as $key) {
            if (array_key_exists($key, $data)) {
                PanelSetting::setValue($key, $data[$key]);
            }
        }

        return response()->json($this->payload());
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(): array
    {
        $weather = PanelSetting::getValue('weather');
        if (!is_array($weather)) {
            $weather = null;
        }

        $layout = PanelSetting::getValue('dashboard_layout');
        if (!is_array($layout)) {
            $layout = null;
        }

        $favorites = PanelSetting::getValue('favorites', []);
        if (!is_array($favorites)) {
            $favorites = [];
        }

        $snapshots = PanelSetting::getValue('scene_snapshots');
        if (!is_array($snapshots)) {
            $snapshots = null;
        }

        $theme = PanelSetting::getValue('theme');
        if (!is_string($theme) || !in_array($theme, ['light', 'dark', 'system'], true)) {
            $theme = 'system';
        }

        return [
            'pin_hash'          => PanelSetting::getValue('pin_hash'),
            'pin_enabled'       => (bool) PanelSetting::getValue('pin_enabled', false),
            'lock_timeout'      => (int) PanelSetting::getValue('lock_timeout', 30),
            'screen_timeout'    => (int) PanelSetting::getValue('screen_timeout', 60),
            'kiosk_mode'        => (bool) PanelSetting::getValue('kiosk_mode', false),
            'calendar_ical_url' => PanelSetting::getValue('calendar_ical_url') ?: null,
            'dashboard_layout'  => $layout,
            'weather'           => $weather,
            'theme'             => $theme,
            'favorites'         => array_values(array_map('intval', $favorites)),
            'scene_snapshots'   => $snapshots,
        ];
    }
}
