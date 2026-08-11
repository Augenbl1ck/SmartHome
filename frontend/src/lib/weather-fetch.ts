import type { PanelSettings, WeatherDaily, WeatherHourly, WeatherResponse } from './api';

type GeoResult = {
  name?: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
};

/** Map WMO weather_code → OpenWeather-ähnlicher Icon-Code (für WeatherIcon). */
export function wmoToIcon(code: number, isDay: boolean): string {
  const d = isDay ? 'd' : 'n';
  if (code === 0) return `01${d}`;
  if (code === 1) return `02${d}`;
  if (code === 2) return `03${d}`;
  if (code === 3) return `04${d}`;
  if (code === 45 || code === 48) return `50${d}`;
  if (code >= 51 && code <= 57) return `09${d}`;
  if (code >= 61 && code <= 67) return `10${d}`;
  if (code >= 71 && code <= 77) return `13${d}`;
  if (code >= 80 && code <= 82) return `09${d}`;
  if (code >= 85 && code <= 86) return `13${d}`;
  if (code >= 95) return `11${d}`;
  return `03${d}`;
}

export function wmoDescription(code: number): string {
  const map: Record<number, string> = {
    0: 'Klar',
    1: 'Überwiegend klar',
    2: 'Teilweise bewölkt',
    3: 'Bedeckt',
    45: 'Nebel',
    48: 'Reifnebel',
    51: 'Leichter Nieselregen',
    53: 'Nieselregen',
    55: 'Starker Nieselregen',
    56: 'Leichter gefrierender Nieselregen',
    57: 'Gefrierender Nieselregen',
    61: 'Leichter Regen',
    63: 'Regen',
    65: 'Starker Regen',
    66: 'Leichter Eisregen',
    67: 'Eisregen',
    71: 'Leichter Schneefall',
    73: 'Schneefall',
    75: 'Starker Schneefall',
    77: 'Schneegriesel',
    80: 'Leichte Regenschauer',
    81: 'Regenschauer',
    82: 'Starke Regenschauer',
    85: 'Leichte Schneeschauer',
    86: 'Schneeschauer',
    95: 'Gewitter',
    96: 'Gewitter mit Hagel',
    99: 'Schweres Gewitter mit Hagel',
  };
  return map[code] ?? 'Unbekannt';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function geocodeCity(city: string): Promise<GeoResult | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'de');
  url.searchParams.set('format', 'json');

  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const data = await res.json() as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

/** Wetter über Open-Meteo (kostenlos, stündlich, kein API-Key). */
export async function fetchWeatherData(settings: Pick<PanelSettings, 'weather'>): Promise<WeatherResponse> {
  const city = settings.weather?.city?.trim() ?? '';
  const unit = settings.weather?.unit === 'imperial' ? 'imperial' : 'metric';

  if (!city) {
    return { configured: false, unit };
  }

  try {
    const geo = await geocodeCity(city);
    if (!geo) {
      return { configured: true, unit, error: 'Stadt nicht gefunden' };
    }

    const displayName = [geo.name, geo.admin1].filter(Boolean).join(', ') || city;

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(geo.latitude));
    url.searchParams.set('longitude', String(geo.longitude));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '7');
    url.searchParams.set('temperature_unit', unit === 'imperial' ? 'fahrenheit' : 'celsius');
    url.searchParams.set('wind_speed_unit', unit === 'imperial' ? 'mph' : 'kmh');
    url.searchParams.set(
      'current',
      [
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
      ].join(','),
    );
    url.searchParams.set(
      'hourly',
      [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation_probability',
        'precipitation',
        'weather_code',
        'wind_speed_10m',
        'cloud_cover',
        'visibility',
      ].join(','),
    );
    url.searchParams.set(
      'daily',
      [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'sunrise',
        'sunset',
        'precipitation_probability_max',
        'precipitation_sum',
        'wind_speed_10m_max',
        'uv_index_max',
      ].join(','),
    );

    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      return { configured: true, unit, error: `Open-Meteo Fehler HTTP ${res.status}` };
    }

    const data = await res.json() as {
      current?: Record<string, number | string>;
      hourly?: {
        time: string[];
        temperature_2m: number[];
        relative_humidity_2m: number[];
        precipitation_probability: (number | null)[];
        weather_code: number[];
        wind_speed_10m: number[];
        visibility?: (number | null)[];
      };
      daily?: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        sunrise: string[];
        sunset: string[];
        precipitation_probability_max: (number | null)[];
        precipitation_sum: number[];
        wind_speed_10m_max: number[];
        uv_index_max: number[];
      };
    };

    const cur = data.current ?? {};
    const isDay = Number(cur.is_day ?? 1) === 1;
    const code = Number(cur.weather_code ?? 0);

    const daily0Max = data.daily?.temperature_2m_max?.[0];
    const daily0Min = data.daily?.temperature_2m_min?.[0];

    // Sichtweite: nächster Stundenwert (m → km)
    let visibilityKm: number | null = null;
    if (data.hourly?.visibility?.length) {
      const now = Date.now();
      const times = data.hourly.time;
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        const diff = Math.abs(new Date(times[i]).getTime() - now);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      const vis = data.hourly.visibility[bestIdx];
      if (vis != null) visibilityKm = Math.round(vis / 1000);
    }

    const current = {
      temp: Math.round(Number(cur.temperature_2m ?? 0)),
      feelsLike: Math.round(Number(cur.apparent_temperature ?? 0)),
      tempMin: Math.round(daily0Min ?? Number(cur.temperature_2m ?? 0)),
      tempMax: Math.round(daily0Max ?? Number(cur.temperature_2m ?? 0)),
      humidity: Math.round(Number(cur.relative_humidity_2m ?? 0)),
      pressure: Math.round(Number(cur.pressure_msl ?? 0)),
      windSpeed: Math.round(Number(cur.wind_speed_10m ?? 0)),
      windDeg: cur.wind_direction_10m != null ? Math.round(Number(cur.wind_direction_10m)) : null,
      clouds: Math.round(Number(cur.cloud_cover ?? 0)),
      visibility: visibilityKm,
      description: wmoDescription(code),
      icon: wmoToIcon(code, isDay),
      city: displayName,
      sunrise: data.daily?.sunrise?.[0] ? new Date(data.daily.sunrise[0]).toISOString() : null,
      sunset: data.daily?.sunset?.[0] ? new Date(data.daily.sunset[0]).toISOString() : null,
      uvIndex: data.daily?.uv_index_max?.[0] != null ? round1(data.daily.uv_index_max[0]) : null,
      precipitation: cur.precipitation != null ? round1(Number(cur.precipitation)) : null,
      windGusts: cur.wind_gusts_10m != null ? Math.round(Number(cur.wind_gusts_10m)) : null,
    };

    const now = Date.now();
    const hourly: WeatherHourly[] = [];
    if (data.hourly?.time) {
      for (let i = 0; i < data.hourly.time.length && hourly.length < 24; i++) {
        const t = new Date(data.hourly.time[i]).getTime();
        // ab aktueller Stunde (nicht weit in der Vergangenheit)
        if (t < now - 45 * 60_000) continue;
        const hCode = data.hourly.weather_code[i] ?? 0;
        const hour = new Date(t).getHours();
        const dayLike = hour >= 6 && hour < 21;
        hourly.push({
          time: new Date(t).toISOString(),
          temp: Math.round(data.hourly.temperature_2m[i] ?? 0),
          icon: wmoToIcon(hCode, dayLike),
          description: wmoDescription(hCode),
          pop: Math.round(data.hourly.precipitation_probability[i] ?? 0),
          humidity: Math.round(data.hourly.relative_humidity_2m[i] ?? 0),
          windSpeed: Math.round(data.hourly.wind_speed_10m[i] ?? 0),
        });
      }
    }

    const daily: WeatherDaily[] = [];
    if (data.daily?.time) {
      for (let i = 0; i < data.daily.time.length && i < 7; i++) {
        const dCode = data.daily.weather_code[i] ?? 0;
        daily.push({
          date: data.daily.time[i],
          tempMin: Math.round(data.daily.temperature_2m_min[i] ?? 0),
          tempMax: Math.round(data.daily.temperature_2m_max[i] ?? 0),
          icon: wmoToIcon(dCode, true),
          description: wmoDescription(dCode),
          pop: Math.round(data.daily.precipitation_probability_max[i] ?? 0),
          humidity: 0, // Open-Meteo daily hat keine mittlere Feuchte — UI zeigt optional nichts
          windSpeed: Math.round(data.daily.wind_speed_10m_max[i] ?? 0),
          precipitationSum: data.daily.precipitation_sum[i] != null
            ? round1(data.daily.precipitation_sum[i])
            : null,
          uvIndex: data.daily.uv_index_max[i] != null ? round1(data.daily.uv_index_max[i]) : null,
        });
      }
    }

    return { configured: true, unit, current, hourly, daily };
  } catch (e) {
    return {
      configured: true,
      unit,
      error: e instanceof Error ? e.message : 'Wetter nicht ladbar',
    };
  }
}
