<?php

namespace App\Services;

use App\Models\PanelSetting;
use App\Support\SnapshotCache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class WeatherService
{

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

        $cacheKey = $this->cacheKey($city, $unit);
        $cached = SnapshotCache::get($cacheKey);
        if (is_array($cached)) {
            return $cached;
        }

        return [
            'configured' => true,
            'unit' => $unit,
            'error' => 'Wetter noch nicht geladen',
        ];
    }

    /**
     * Holt Open-Meteo und schreibt den Snapshot. Nur Scheduler / CLI.
     *
     * @return array<string, mixed>
     */
    public function refresh(): array
    {
        $weather = PanelSetting::getValue('weather');
        $city = is_array($weather) ? trim((string) ($weather['city'] ?? '')) : '';
        $unit = is_array($weather) && ($weather['unit'] ?? '') === 'imperial' ? 'imperial' : 'metric';

        if ($city === '') {
            return ['configured' => false, 'unit' => $unit];
        }

        try {
            $data = $this->fetchAll($city, $unit);
            SnapshotCache::put($this->cacheKey($city, $unit), $data);

            return $data;
        } catch (\Throwable $e) {
            $stale = SnapshotCache::get($this->cacheKey($city, $unit));
            if (is_array($stale)) {
                return $stale;
            }

            return [
                'configured' => true,
                'unit' => $unit,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function cacheKey(string $city, string $unit): string
    {
        return 'weather_om_' . sha1($city . '|' . $unit);
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
    private function fetchAll(string $city, string $unit): array
    {
        $geo = $this->geocodeCity($city);
        if ($geo === null) {
            throw new RuntimeException('Stadt nicht gefunden');
        }

        $displayName = implode(', ', array_filter([
            $geo['name'] ?? null,
            $geo['admin1'] ?? null,
        ])) ?: $city;

        $url = 'https://api.open-meteo.com/v1/forecast';
        $query = [
            'latitude' => $geo['latitude'],
            'longitude' => $geo['longitude'],
            'timezone' => 'auto',
            'forecast_days' => 7,
            'temperature_unit' => $unit === 'imperial' ? 'fahrenheit' : 'celsius',
            'wind_speed_unit' => $unit === 'imperial' ? 'mph' : 'kmh',
            'current' => implode(',', [
                'temperature_2m',
                'relative_humidity_2m',
                'apparent_temperature',
                'is_day',
                'precipitation',
                'weather_code',
                'cloud_cover',
                'pressure_msl',
                'wind_speed_10m',
                'wind_direction_10m',
                'wind_gusts_10m',
            ]),
            'hourly' => implode(',', [
                'temperature_2m',
                'relative_humidity_2m',
                'apparent_temperature',
                'precipitation_probability',
                'precipitation',
                'weather_code',
                'wind_speed_10m',
                'cloud_cover',
                'visibility',
            ]),
            'daily' => implode(',', [
                'weather_code',
                'temperature_2m_max',
                'temperature_2m_min',
                'sunrise',
                'sunset',
                'precipitation_probability_max',
                'precipitation_sum',
                'wind_speed_10m_max',
                'uv_index_max',
            ]),
        ];

        $res = Http::timeout(12)->get($url, $query);
        if (!$res->successful()) {
            throw new RuntimeException('Open-Meteo Fehler HTTP ' . $res->status());
        }

        $data = $res->json();
        if (!is_array($data)) {
            throw new RuntimeException('Open-Meteo: ungültige Antwort');
        }

        /** @var array<string, mixed> $cur */
        $cur = is_array($data['current'] ?? null) ? $data['current'] : [];
        $isDay = ((int) ($cur['is_day'] ?? 1)) === 1;
        $code = (int) ($cur['weather_code'] ?? 0);

        $dailyBlock = is_array($data['daily'] ?? null) ? $data['daily'] : [];
        $hourlyBlock = is_array($data['hourly'] ?? null) ? $data['hourly'] : [];

        $daily0Max = isset($dailyBlock['temperature_2m_max'][0]) ? (float) $dailyBlock['temperature_2m_max'][0] : null;
        $daily0Min = isset($dailyBlock['temperature_2m_min'][0]) ? (float) $dailyBlock['temperature_2m_min'][0] : null;

        $visibilityKm = $this->nearestHourlyVisibilityKm($hourlyBlock);

        $sunrise = isset($dailyBlock['sunrise'][0]) ? $this->toIso((string) $dailyBlock['sunrise'][0]) : null;
        $sunset = isset($dailyBlock['sunset'][0]) ? $this->toIso((string) $dailyBlock['sunset'][0]) : null;

        $current = [
            'temp' => (int) round((float) ($cur['temperature_2m'] ?? 0)),
            'feelsLike' => (int) round((float) ($cur['apparent_temperature'] ?? 0)),
            'tempMin' => (int) round($daily0Min ?? (float) ($cur['temperature_2m'] ?? 0)),
            'tempMax' => (int) round($daily0Max ?? (float) ($cur['temperature_2m'] ?? 0)),
            'humidity' => (int) round((float) ($cur['relative_humidity_2m'] ?? 0)),
            'pressure' => (int) round((float) ($cur['pressure_msl'] ?? 0)),
            'windSpeed' => (int) round((float) ($cur['wind_speed_10m'] ?? 0)),
            'windDeg' => isset($cur['wind_direction_10m']) ? (int) round((float) $cur['wind_direction_10m']) : null,
            'clouds' => (int) round((float) ($cur['cloud_cover'] ?? 0)),
            'visibility' => $visibilityKm,
            'description' => $this->wmoDescription($code),
            'icon' => $this->wmoToIcon($code, $isDay),
            'city' => $displayName,
            'sunrise' => $sunrise,
            'sunset' => $sunset,
            'uvIndex' => isset($dailyBlock['uv_index_max'][0]) ? $this->round1((float) $dailyBlock['uv_index_max'][0]) : null,
            'precipitation' => isset($cur['precipitation']) ? $this->round1((float) $cur['precipitation']) : null,
            'windGusts' => isset($cur['wind_gusts_10m']) ? (int) round((float) $cur['wind_gusts_10m']) : null,
        ];

        $hourly = $this->buildHourly($hourlyBlock);
        $daily = $this->buildDaily($dailyBlock);

        return [
            'configured' => true,
            'unit' => $unit,
            'current' => $current,
            'hourly' => $hourly,
            'daily' => $daily,
        ];
    }

    /**
     * @return array{name?: string, latitude: float, longitude: float, country?: string, admin1?: string}|null
     */
    private function geocodeCity(string $city): ?array
    {
        $res = Http::timeout(12)->get('https://geocoding-api.open-meteo.com/v1/search', [
            'name' => $city,
            'count' => 1,
            'language' => 'de',
            'format' => 'json',
        ]);

        if (!$res->successful()) {
            return null;
        }

        $results = $res->json('results');
        if (!is_array($results) || !isset($results[0]) || !is_array($results[0])) {
            return null;
        }

        $first = $results[0];
        if (!isset($first['latitude'], $first['longitude'])) {
            return null;
        }

        return [
            'name' => isset($first['name']) ? (string) $first['name'] : null,
            'latitude' => (float) $first['latitude'],
            'longitude' => (float) $first['longitude'],
            'country' => isset($first['country']) ? (string) $first['country'] : null,
            'admin1' => isset($first['admin1']) ? (string) $first['admin1'] : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $hourly
     */
    private function nearestHourlyVisibilityKm(array $hourly): ?int
    {
        $times = $hourly['time'] ?? null;
        $vis = $hourly['visibility'] ?? null;
        if (!is_array($times) || !is_array($vis) || $times === []) {
            return null;
        }

        $now = time() * 1000;
        $bestIdx = 0;
        $bestDiff = INF;
        foreach ($times as $i => $t) {
            $ms = strtotime((string) $t);
            if ($ms === false) {
                continue;
            }
            $diff = abs($ms * 1000 - $now);
            if ($diff < $bestDiff) {
                $bestDiff = $diff;
                $bestIdx = (int) $i;
            }
        }

        $value = $vis[$bestIdx] ?? null;
        if ($value === null || !is_numeric($value)) {
            return null;
        }

        return (int) round(((float) $value) / 1000);
    }

    /**
     * @param  array<string, mixed>  $hourly
     * @return list<array<string, mixed>>
     */
    private function buildHourly(array $hourly): array
    {
        $times = $hourly['time'] ?? null;
        if (!is_array($times)) {
            return [];
        }

        $temps = is_array($hourly['temperature_2m'] ?? null) ? $hourly['temperature_2m'] : [];
        $codes = is_array($hourly['weather_code'] ?? null) ? $hourly['weather_code'] : [];
        $pops = is_array($hourly['precipitation_probability'] ?? null) ? $hourly['precipitation_probability'] : [];
        $hums = is_array($hourly['relative_humidity_2m'] ?? null) ? $hourly['relative_humidity_2m'] : [];
        $winds = is_array($hourly['wind_speed_10m'] ?? null) ? $hourly['wind_speed_10m'] : [];

        $now = time();
        $out = [];
        foreach ($times as $i => $t) {
            if (count($out) >= 24) {
                break;
            }
            $ts = strtotime((string) $t);
            if ($ts === false || $ts < $now - 45 * 60) {
                continue;
            }
            $hCode = (int) ($codes[$i] ?? 0);
            $hour = (int) date('G', $ts);
            $dayLike = $hour >= 6 && $hour < 21;
            $out[] = [
                'time' => $this->toIso((string) $t),
                'temp' => (int) round((float) ($temps[$i] ?? 0)),
                'icon' => $this->wmoToIcon($hCode, $dayLike),
                'description' => $this->wmoDescription($hCode),
                'pop' => (int) round((float) ($pops[$i] ?? 0)),
                'humidity' => (int) round((float) ($hums[$i] ?? 0)),
                'windSpeed' => (int) round((float) ($winds[$i] ?? 0)),
            ];
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $daily
     * @return list<array<string, mixed>>
     */
    private function buildDaily(array $daily): array
    {
        $times = $daily['time'] ?? null;
        if (!is_array($times)) {
            return [];
        }

        $codes = is_array($daily['weather_code'] ?? null) ? $daily['weather_code'] : [];
        $mins = is_array($daily['temperature_2m_min'] ?? null) ? $daily['temperature_2m_min'] : [];
        $maxs = is_array($daily['temperature_2m_max'] ?? null) ? $daily['temperature_2m_max'] : [];
        $pops = is_array($daily['precipitation_probability_max'] ?? null) ? $daily['precipitation_probability_max'] : [];
        $winds = is_array($daily['wind_speed_10m_max'] ?? null) ? $daily['wind_speed_10m_max'] : [];
        $precs = is_array($daily['precipitation_sum'] ?? null) ? $daily['precipitation_sum'] : [];
        $uvs = is_array($daily['uv_index_max'] ?? null) ? $daily['uv_index_max'] : [];

        $out = [];
        foreach ($times as $i => $date) {
            if ($i >= 7) {
                break;
            }
            $dCode = (int) ($codes[$i] ?? 0);
            $out[] = [
                'date' => (string) $date,
                'tempMin' => (int) round((float) ($mins[$i] ?? 0)),
                'tempMax' => (int) round((float) ($maxs[$i] ?? 0)),
                'icon' => $this->wmoToIcon($dCode, true),
                'description' => $this->wmoDescription($dCode),
                'pop' => (int) round((float) ($pops[$i] ?? 0)),
                'humidity' => 0,
                'windSpeed' => (int) round((float) ($winds[$i] ?? 0)),
                'precipitationSum' => isset($precs[$i]) && is_numeric($precs[$i]) ? $this->round1((float) $precs[$i]) : null,
                'uvIndex' => isset($uvs[$i]) && is_numeric($uvs[$i]) ? $this->round1((float) $uvs[$i]) : null,
            ];
        }

        return $out;
    }

    private function wmoToIcon(int $code, bool $isDay): string
    {
        $d = $isDay ? 'd' : 'n';
        if ($code === 0) {
            return "01{$d}";
        }
        if ($code === 1) {
            return "02{$d}";
        }
        if ($code === 2) {
            return "03{$d}";
        }
        if ($code === 3) {
            return "04{$d}";
        }
        if ($code === 45 || $code === 48) {
            return "50{$d}";
        }
        if ($code >= 51 && $code <= 57) {
            return "09{$d}";
        }
        if ($code >= 61 && $code <= 67) {
            return "10{$d}";
        }
        if ($code >= 71 && $code <= 77) {
            return "13{$d}";
        }
        if ($code >= 80 && $code <= 82) {
            return "09{$d}";
        }
        if ($code >= 85 && $code <= 86) {
            return "13{$d}";
        }
        if ($code >= 95) {
            return "11{$d}";
        }

        return "03{$d}";
    }

    private function wmoDescription(int $code): string
    {
        return match ($code) {
            0 => 'Klar',
            1 => 'Überwiegend klar',
            2 => 'Teilweise bewölkt',
            3 => 'Bedeckt',
            45 => 'Nebel',
            48 => 'Reifnebel',
            51 => 'Leichter Nieselregen',
            53 => 'Nieselregen',
            55 => 'Starker Nieselregen',
            56 => 'Leichter gefrierender Nieselregen',
            57 => 'Gefrierender Nieselregen',
            61 => 'Leichter Regen',
            63 => 'Regen',
            65 => 'Starker Regen',
            66 => 'Leichter Eisregen',
            67 => 'Eisregen',
            71 => 'Leichter Schneefall',
            73 => 'Schneefall',
            75 => 'Starker Schneefall',
            77 => 'Schneegriesel',
            80 => 'Leichte Regenschauer',
            81 => 'Regenschauer',
            82 => 'Starke Regenschauer',
            85 => 'Leichte Schneeschauer',
            86 => 'Schneeschauer',
            95 => 'Gewitter',
            96 => 'Gewitter mit Hagel',
            99 => 'Schweres Gewitter mit Hagel',
            default => 'Unbekannt',
        };
    }

    private function round1(float $n): float
    {
        return round($n * 10) / 10;
    }

    private function toIso(string $value): string
    {
        $ts = strtotime($value);

        return $ts === false ? $value : date('c', $ts);
    }
}
