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
        'screen_power_off',
        'kiosk_mode',
        'calendar_ical_url',
        'dashboard_layout',
        'weather',
        'transit',
        'energy',
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
            'screen_power_off'  => 'sometimes|boolean',
            'kiosk_mode'        => 'sometimes|boolean',
            'calendar_ical_url' => 'sometimes|nullable|string|max:2000',
            'dashboard_layout'  => 'sometimes|nullable|array',
            'weather'           => 'sometimes|nullable|array',
            'weather.city'      => 'sometimes|nullable|string|max:120',
            'weather.unit'      => 'sometimes|nullable|string|in:metric,imperial',
            'transit'           => 'sometimes|nullable|array',
            'transit.stations'  => 'sometimes|nullable|array|max:3',
            'transit.stations.*.id'   => 'required_with:transit.stations|string|max:64',
            'transit.stations.*.name' => 'required_with:transit.stations|string|max:200',
            'transit.connections' => 'sometimes|nullable|array|max:3',
            'transit.connections.*.id' => 'sometimes|nullable|string|max:64',
            'transit.connections.*.label' => 'sometimes|nullable|string|max:120',
            'transit.connections.*.from' => 'required_with:transit.connections|array',
            'transit.connections.*.from.id' => 'required_with:transit.connections|string|max:64',
            'transit.connections.*.from.name' => 'required_with:transit.connections|string|max:200',
            'transit.connections.*.to' => 'required_with:transit.connections|array',
            'transit.connections.*.to.id' => 'required_with:transit.connections|string|max:64',
            'transit.connections.*.to.name' => 'required_with:transit.connections|string|max:200',
            'energy'            => 'sometimes|nullable|array',
            'energy.price_per_kwh' => 'sometimes|nullable|numeric|min:0|max:10',
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

        if (array_key_exists('transit', $data)) {
            $data['transit'] = $this->normalizeTransit(is_array($data['transit']) ? $data['transit'] : null);
        }

        if (array_key_exists('energy', $data)) {
            $data['energy'] = $this->normalizeEnergy(is_array($data['energy']) ? $data['energy'] : null);
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

        $transitRaw = PanelSetting::getValue('transit');
        $transit = $this->normalizeTransit(is_array($transitRaw) ? $transitRaw : null);

        $energyRaw = PanelSetting::getValue('energy');
        $energy = $this->normalizeEnergy(is_array($energyRaw) ? $energyRaw : null);

        $spotifyRaw = PanelSetting::getValue('spotify');
        $spotifyConnected = is_array($spotifyRaw) && !empty($spotifyRaw['refresh_token']);
        $spotifyName = null;
        if ($spotifyConnected && !empty($spotifyRaw['display_name'])) {
            $spotifyName = (string) $spotifyRaw['display_name'];
        }

        return [
            'pin_hash'          => PanelSetting::getValue('pin_hash'),
            'pin_enabled'       => (bool) PanelSetting::getValue('pin_enabled', false),
            'lock_timeout'      => (int) PanelSetting::getValue('lock_timeout', 30),
            'screen_timeout'    => (int) PanelSetting::getValue('screen_timeout', 60),
            'screen_power_off'  => (bool) PanelSetting::getValue('screen_power_off', false),
            'kiosk_mode'        => (bool) PanelSetting::getValue('kiosk_mode', false),
            'calendar_ical_url' => PanelSetting::getValue('calendar_ical_url') ?: null,
            'dashboard_layout'  => $layout,
            'weather'           => $weather,
            'transit'           => $transit,
            'energy'            => $energy,
            'spotify'           => [
                'connected' => $spotifyConnected,
                'display_name' => $spotifyName,
                'has_streaming' => $spotifyConnected && is_array($spotifyRaw)
                    ? (bool) preg_match('/(?:^|\s)streaming(?:\s|$)/i', (string) ($spotifyRaw['scope'] ?? ''))
                    : false,
            ],
            'theme'             => $theme,
            'favorites'         => array_values(array_map('intval', $favorites)),
            'scene_snapshots'   => $snapshots,
        ];
    }

    /**
     * @param  array<string, mixed>|null  $raw
     * @return array{price_per_kwh: float}
     */
    private function normalizeEnergy(?array $raw): array
    {
        $price = 0.30;
        if ($raw !== null && isset($raw['price_per_kwh']) && is_numeric($raw['price_per_kwh'])) {
            $p = (float) $raw['price_per_kwh'];
            if ($p >= 0 && $p <= 10) {
                $price = round($p, 4);
            }
        }

        return ['price_per_kwh' => $price];
    }

    /**
     * @param  array<string, mixed>|null  $raw
     * @return array{
     *   stations: list<array{id: string, name: string}>,
     *   connections: list<array{id: string, label: string, from: array{id: string, name: string}, to: array{id: string, name: string}}>
     * }
     */
    private function normalizeTransit(?array $raw): array
    {
        if ($raw === null) {
            return ['stations' => [], 'connections' => []];
        }

        $stations = [];
        foreach (array_slice($raw['stations'] ?? [], 0, 3) as $s) {
            if (!is_array($s)) {
                continue;
            }
            $id = trim((string) ($s['id'] ?? ''));
            $name = trim((string) ($s['name'] ?? ''));
            if ($id === '' || $name === '') {
                continue;
            }
            $stations[] = ['id' => $id, 'name' => $name];
        }

        $connections = [];
        foreach (array_slice($raw['connections'] ?? [], 0, 3) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $from = is_array($c['from'] ?? null) ? $c['from'] : [];
            $to = is_array($c['to'] ?? null) ? $c['to'] : [];
            $fromId = trim((string) ($from['id'] ?? ''));
            $fromName = trim((string) ($from['name'] ?? ''));
            $toId = trim((string) ($to['id'] ?? ''));
            $toName = trim((string) ($to['name'] ?? ''));
            if ($fromId === '' || $toId === '' || $fromName === '' || $toName === '') {
                continue;
            }
            $id = trim((string) ($c['id'] ?? ''));
            if ($id === '') {
                $id = 'c_' . substr(sha1($fromId . '|' . $toId), 0, 8);
            }
            $label = trim((string) ($c['label'] ?? ''));
            if ($label === '') {
                $label = $fromName . ' → ' . $toName;
            }
            $connections[] = [
                'id' => $id,
                'label' => mb_substr($label, 0, 120),
                'from' => ['id' => $fromId, 'name' => $fromName],
                'to' => ['id' => $toId, 'name' => $toName],
            ];
        }

        return ['stations' => $stations, 'connections' => $connections];
    }
}
