<?php

namespace App\Services;

use App\Models\PanelSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class SunTimesService
{
    private const CACHE_TTL = 21600; // 6h

    /**
     * @return array{sunrise: string|null, sunset: string|null}|null ISO times in Europe/Berlin local sense (H:i matched via Carbon)
     */
    public function today(): ?array
    {
        $weather = PanelSetting::getValue('weather');
        $city = is_array($weather) ? trim((string) ($weather['city'] ?? '')) : '';
        if ($city === '') {
            return null;
        }

        $date = now('Europe/Berlin')->format('Y-m-d');
        $cacheKey = 'sun_times_' . sha1(mb_strtolower($city) . '|' . $date);

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($city, $date) {
            $geo = Http::timeout(12)
                ->withHeaders(['User-Agent' => 'SmartHomePanel/1.0'])
                ->get('https://geocoding-api.open-meteo.com/v1/search', [
                    'name' => $city,
                    'count' => 1,
                    'language' => 'de',
                    'format' => 'json',
                ]);

            if (!$geo->successful()) {
                return null;
            }

            $results = $geo->json('results');
            if (!is_array($results) || $results === []) {
                return null;
            }

            $lat = $results[0]['latitude'] ?? null;
            $lon = $results[0]['longitude'] ?? null;
            if (!is_numeric($lat) || !is_numeric($lon)) {
                return null;
            }

            $wx = Http::timeout(12)
                ->withHeaders(['User-Agent' => 'SmartHomePanel/1.0'])
                ->get('https://api.open-meteo.com/v1/forecast', [
                    'latitude' => $lat,
                    'longitude' => $lon,
                    'daily' => 'sunrise,sunset',
                    'timezone' => 'Europe/Berlin',
                    'forecast_days' => 1,
                    'start_date' => $date,
                    'end_date' => $date,
                ]);

            if (!$wx->successful()) {
                return null;
            }

            $sunrise = $wx->json('daily.sunrise.0');
            $sunset = $wx->json('daily.sunset.0');

            return [
                'sunrise' => is_string($sunrise) ? $sunrise : null,
                'sunset' => is_string($sunset) ? $sunset : null,
            ];
        });
    }

    /**
     * True if current Berlin local H:i equals sun event + offset.
     */
    public function matchesNow(string $event, int $offsetMinutes = 0): bool
    {
        $times = $this->today();
        if ($times === null) {
            return false;
        }

        $iso = $event === 'sunset' ? ($times['sunset'] ?? null) : ($times['sunrise'] ?? null);
        if (!is_string($iso) || $iso === '') {
            return false;
        }

        try {
            $target = \Carbon\Carbon::parse($iso)->timezone('Europe/Berlin')->addMinutes($offsetMinutes);
        } catch (\Throwable) {
            return false;
        }

        return $target->format('H:i') === now('Europe/Berlin')->format('H:i');
    }
}
