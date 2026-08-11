<?php

namespace App\Services;

use App\Models\PanelSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class WeatherService
{
    private const CACHE_TTL = 300; // 5 Min

    /**
     * @return array{
     *   configured: bool,
     *   unit: string,
     *   current?: array<string, mixed>,
     *   hourly?: list<array<string, mixed>>,
     *   daily?: list<array<string, mixed>>,
     *   error?: string
     * }
     */
    public function forecast(): array
    {
        $weather = PanelSetting::getValue('weather');
        $city = is_array($weather) ? trim((string) ($weather['city'] ?? '')) : '';
        $unit = is_array($weather) && ($weather['unit'] ?? '') === 'imperial' ? 'imperial' : 'metric';

        if ($city === '') {
            return ['configured' => false, 'unit' => $unit];
        }

        $apiKey = (string) config('services.openweather.key', '');
        if ($apiKey === '') {
            return [
                'configured' => true,
                'unit' => $unit,
                'error' => 'WEATHER_API_KEY fehlt in der Backend-.env',
            ];
        }

        $cacheKey = 'weather_full_' . sha1($city . '|' . $unit);

        try {
            return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($city, $unit, $apiKey) {
                return $this->fetchAll($city, $unit, $apiKey);
            });
        } catch (\Throwable $e) {
            return [
                'configured' => true,
                'unit' => $unit,
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * @return array{
     *   configured: bool,
     *   unit: string,
     *   current: array<string, mixed>,
     *   hourly: list<array<string, mixed>>,
     *   daily: list<array<string, mixed>>
     * }
     */
    private function fetchAll(string $city, string $unit, string $apiKey): array
    {
        $currentRes = Http::timeout(12)->get('https://api.openweathermap.org/data/2.5/weather', [
            'q' => $city,
            'appid' => $apiKey,
            'units' => $unit,
            'lang' => 'de',
        ]);

        if ($currentRes->status() === 401) {
            throw new RuntimeException('Ungültiger API-Key');
        }
        if ($currentRes->status() === 404) {
            throw new RuntimeException('Stadt nicht gefunden');
        }
        if (!$currentRes->successful()) {
            throw new RuntimeException('Wetter-API Fehler HTTP ' . $currentRes->status());
        }

        $c = $currentRes->json();
        $lat = $c['coord']['lat'] ?? null;
        $lon = $c['coord']['lon'] ?? null;

        $current = [
            'temp' => (int) round((float) ($c['main']['temp'] ?? 0)),
            'feelsLike' => (int) round((float) ($c['main']['feels_like'] ?? 0)),
            'tempMin' => (int) round((float) ($c['main']['temp_min'] ?? 0)),
            'tempMax' => (int) round((float) ($c['main']['temp_max'] ?? 0)),
            'humidity' => (int) ($c['main']['humidity'] ?? 0),
            'pressure' => (int) ($c['main']['pressure'] ?? 0),
            'windSpeed' => $unit === 'imperial'
                ? (int) round((float) ($c['wind']['speed'] ?? 0))
                : (int) round(((float) ($c['wind']['speed'] ?? 0)) * 3.6),
            'windDeg' => isset($c['wind']['deg']) ? (int) $c['wind']['deg'] : null,
            'clouds' => (int) ($c['clouds']['all'] ?? 0),
            'visibility' => isset($c['visibility']) ? (int) round(((int) $c['visibility']) / 1000) : null,
            'description' => (string) ($c['weather'][0]['description'] ?? ''),
            'icon' => (string) ($c['weather'][0]['icon'] ?? '01d'),
            'city' => (string) ($c['name'] ?? $city),
            'sunrise' => isset($c['sys']['sunrise']) ? date('c', (int) $c['sys']['sunrise']) : null,
            'sunset' => isset($c['sys']['sunset']) ? date('c', (int) $c['sys']['sunset']) : null,
        ];

        $hourly = [];
        $daily = [];

        if ($lat !== null && $lon !== null) {
            $forecastRes = Http::timeout(12)->get('https://api.openweathermap.org/data/2.5/forecast', [
                'lat' => $lat,
                'lon' => $lon,
                'appid' => $apiKey,
                'units' => $unit,
                'lang' => 'de',
            ]);

            if ($forecastRes->successful()) {
                $list = $forecastRes->json('list') ?? [];
                $tzOffset = (int) ($forecastRes->json('city.timezone') ?? 0);
                [$hourly, $daily] = $this->buildSeries($list, $unit, $tzOffset);
            }
        }

        return [
            'configured' => true,
            'unit' => $unit,
            'current' => $current,
            'hourly' => $hourly,
            'daily' => $daily,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $list
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function buildSeries(array $list, string $unit, int $tzOffset): array
    {
        $today = gmdate('Y-m-d', time() + $tzOffset);
        $hourly = [];
        $byDay = [];

        foreach ($list as $item) {
            $dt = (int) ($item['dt'] ?? 0);
            $localTs = $dt + $tzOffset;
            $dayKey = gmdate('Y-m-d', $localTs);
            $temp = (float) ($item['main']['temp'] ?? 0);
            $tempMin = (float) ($item['main']['temp_min'] ?? $temp);
            $tempMax = (float) ($item['main']['temp_max'] ?? $temp);
            $icon = (string) ($item['weather'][0]['icon'] ?? '01d');
            $desc = (string) ($item['weather'][0]['description'] ?? '');
            $pop = (float) ($item['pop'] ?? 0);
            $humidity = (int) ($item['main']['humidity'] ?? 0);
            $wind = (float) ($item['wind']['speed'] ?? 0);
            $windSpeed = $unit === 'imperial' ? (int) round($wind) : (int) round($wind * 3.6);

            if ($dayKey === $today && count($hourly) < 8) {
                $hourly[] = [
                    'time' => date('c', $dt),
                    'temp' => (int) round($temp),
                    'icon' => $icon,
                    'description' => $desc,
                    'pop' => (int) round($pop * 100),
                    'humidity' => $humidity,
                    'windSpeed' => $windSpeed,
                ];
            }

            if (!isset($byDay[$dayKey])) {
                $byDay[$dayKey] = [
                    'date' => $dayKey,
                    'tempMin' => $tempMin,
                    'tempMax' => $tempMax,
                    'icon' => $icon,
                    'description' => $desc,
                    'pop' => $pop,
                    'humiditySum' => $humidity,
                    'humidityN' => 1,
                    'windMax' => $windSpeed,
                ];
            } else {
                $byDay[$dayKey]['tempMin'] = min($byDay[$dayKey]['tempMin'], $tempMin);
                $byDay[$dayKey]['tempMax'] = max($byDay[$dayKey]['tempMax'], $tempMax);
                $byDay[$dayKey]['pop'] = max($byDay[$dayKey]['pop'], $pop);
                $byDay[$dayKey]['humiditySum'] += $humidity;
                $byDay[$dayKey]['humidityN']++;
                $byDay[$dayKey]['windMax'] = max($byDay[$dayKey]['windMax'], $windSpeed);
                // Prefer midday-ish icon (around 12:00 local)
                $hour = (int) gmdate('G', $localTs);
                if ($hour >= 11 && $hour <= 14) {
                    $byDay[$dayKey]['icon'] = $icon;
                    $byDay[$dayKey]['description'] = $desc;
                }
            }
        }

        $daily = [];
        foreach (array_slice(array_values($byDay), 0, 7) as $d) {
            $daily[] = [
                'date' => $d['date'],
                'tempMin' => (int) round($d['tempMin']),
                'tempMax' => (int) round($d['tempMax']),
                'icon' => $d['icon'],
                'description' => $d['description'],
                'pop' => (int) round($d['pop'] * 100),
                'humidity' => (int) round($d['humiditySum'] / max(1, $d['humidityN'])),
                'windSpeed' => (int) $d['windMax'],
            ];
        }

        return [$hourly, $daily];
    }
}
