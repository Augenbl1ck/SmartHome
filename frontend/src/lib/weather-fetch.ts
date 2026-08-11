import type { PanelSettings, WeatherDaily, WeatherHourly, WeatherResponse } from './api';

const OW_KEY = () =>
  process.env.NEXT_PUBLIC_WEATHER_API_KEY?.trim()
  || process.env.WEATHER_API_KEY?.trim()
  || '';

type OwCurrent = {
  name?: string;
  coord?: { lat: number; lon: number };
  main?: {
    temp?: number;
    feels_like?: number;
    temp_min?: number;
    temp_max?: number;
    humidity?: number;
    pressure?: number;
  };
  wind?: { speed?: number; deg?: number };
  clouds?: { all?: number };
  visibility?: number;
  weather?: { description?: string; icon?: string }[];
  sys?: { sunrise?: number; sunset?: number };
};

type OwForecastItem = {
  dt: number;
  main?: { temp?: number; temp_min?: number; temp_max?: number; humidity?: number };
  weather?: { description?: string; icon?: string }[];
  pop?: number;
  wind?: { speed?: number };
};

type OwOneCallHourly = {
  dt: number;
  temp?: number;
  humidity?: number;
  pop?: number;
  wind_speed?: number;
  weather?: { description?: string; icon?: string }[];
};

type OwOneCallDaily = {
  dt: number;
  temp?: { min?: number; max?: number };
  humidity?: number;
  pop?: number;
  wind_speed?: number;
  weather?: { description?: string; icon?: string }[];
};

function windSpeed(mps: number, unit: string): number {
  return unit === 'imperial' ? Math.round(mps) : Math.round(mps * 3.6);
}

function ymdUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build 24 hourly points from 3-hour forecast (linear temp between slots). */
function hourlyFrom3hForecast(
  list: OwForecastItem[],
  unit: string,
  nowSec: number,
): WeatherHourly[] {
  const future = list
    .filter(i => i.dt >= nowSec - 30 * 60)
    .sort((a, b) => a.dt - b.dt);

  if (future.length === 0) return [];

  const endSec = nowSec + 24 * 3600;
  const out: WeatherHourly[] = [];

  // Start at the next full hour
  const startHour = Math.ceil(nowSec / 3600) * 3600;

  for (let t = startHour; t <= endSec && out.length < 24; t += 3600) {
    // Find surrounding 3h points
    let prev = future[0];
    let next = future[0];
    for (let i = 0; i < future.length; i++) {
      if (future[i].dt <= t) prev = future[i];
      if (future[i].dt >= t) {
        next = future[i];
        break;
      }
      next = future[i];
    }

    let temp: number;
    if (prev.dt === next.dt || t <= prev.dt) {
      temp = prev.main?.temp ?? 0;
    } else if (t >= next.dt) {
      temp = next.main?.temp ?? 0;
    } else {
      const ratio = (t - prev.dt) / (next.dt - prev.dt);
      const a = prev.main?.temp ?? 0;
      const b = next.main?.temp ?? 0;
      temp = a + (b - a) * ratio;
    }

    // Prefer the nearer slot for icon / pop / humidity / wind
    const nearer = Math.abs(t - prev.dt) <= Math.abs(t - next.dt) ? prev : next;
    out.push({
      time: new Date(t * 1000).toISOString(),
      temp: Math.round(temp),
      icon: nearer.weather?.[0]?.icon ?? '01d',
      description: nearer.weather?.[0]?.description ?? '',
      pop: Math.round((nearer.pop ?? 0) * 100),
      humidity: nearer.main?.humidity ?? 0,
      windSpeed: windSpeed(nearer.wind?.speed ?? 0, unit),
    });
  }

  return out;
}

function dailyFrom3hForecast(
  list: OwForecastItem[],
  unit: string,
  tzOffset: number,
): WeatherDaily[] {
  const byDay = new Map<string, {
    date: string;
    tempMin: number;
    tempMax: number;
    icon: string;
    description: string;
    pop: number;
    humiditySum: number;
    humidityN: number;
    windMax: number;
  }>();

  for (const item of list) {
    const localMs = (item.dt + tzOffset) * 1000;
    const dayKey = ymdUtc(localMs);
    const temp = item.main?.temp ?? 0;
    const tempMin = item.main?.temp_min ?? temp;
    const tempMax = item.main?.temp_max ?? temp;
    const icon = item.weather?.[0]?.icon ?? '01d';
    const description = item.weather?.[0]?.description ?? '';
    const pop = item.pop ?? 0;
    const humidity = item.main?.humidity ?? 0;
    const ws = windSpeed(item.wind?.speed ?? 0, unit);

    const existing = byDay.get(dayKey);
    if (!existing) {
      byDay.set(dayKey, {
        date: dayKey,
        tempMin,
        tempMax,
        icon,
        description,
        pop,
        humiditySum: humidity,
        humidityN: 1,
        windMax: ws,
      });
    } else {
      existing.tempMin = Math.min(existing.tempMin, tempMin);
      existing.tempMax = Math.max(existing.tempMax, tempMax);
      existing.pop = Math.max(existing.pop, pop);
      existing.humiditySum += humidity;
      existing.humidityN += 1;
      existing.windMax = Math.max(existing.windMax, ws);
      const hour = new Date(localMs).getUTCHours();
      if (hour >= 11 && hour <= 14) {
        existing.icon = icon;
        existing.description = description;
      }
    }
  }

  return [...byDay.values()].slice(0, 7).map(d => ({
    date: d.date,
    tempMin: Math.round(d.tempMin),
    tempMax: Math.round(d.tempMax),
    icon: d.icon,
    description: d.description,
    pop: Math.round(d.pop * 100),
    humidity: Math.round(d.humiditySum / Math.max(1, d.humidityN)),
    windSpeed: d.windMax,
  }));
}

async function tryOneCall(
  lat: number,
  lon: number,
  unit: string,
  apiKey: string,
): Promise<{ hourly: WeatherHourly[]; daily: WeatherDaily[] } | null> {
  // One Call 3.0 (hourly) — falls Key freigeschaltet
  const url = new URL('https://api.openweathermap.org/data/3.0/onecall');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', unit);
  url.searchParams.set('lang', 'de');
  url.searchParams.set('exclude', 'minutely,alerts');

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;

  const data = await res.json() as {
    hourly?: OwOneCallHourly[];
    daily?: OwOneCallDaily[];
  };

  const now = Math.floor(Date.now() / 1000);
  const hourly: WeatherHourly[] = (data.hourly ?? [])
    .filter(h => h.dt >= now - 1800)
    .slice(0, 24)
    .map(h => ({
      time: new Date(h.dt * 1000).toISOString(),
      temp: Math.round(h.temp ?? 0),
      icon: h.weather?.[0]?.icon ?? '01d',
      description: h.weather?.[0]?.description ?? '',
      pop: Math.round((h.pop ?? 0) * 100),
      humidity: h.humidity ?? 0,
      windSpeed: windSpeed(h.wind_speed ?? 0, unit),
    }));

  const daily: WeatherDaily[] = (data.daily ?? []).slice(0, 7).map(d => ({
    date: ymdUtc(d.dt * 1000),
    tempMin: Math.round(d.temp?.min ?? 0),
    tempMax: Math.round(d.temp?.max ?? 0),
    icon: d.weather?.[0]?.icon ?? '01d',
    description: d.weather?.[0]?.description ?? '',
    pop: Math.round((d.pop ?? 0) * 100),
    humidity: d.humidity ?? 0,
    windSpeed: windSpeed(d.wind_speed ?? 0, unit),
  }));

  if (hourly.length === 0) return null;
  return { hourly, daily };
}

/** OpenWeather fetch using NEXT_PUBLIC_WEATHER_API_KEY + panel weather city/unit. */
export async function fetchWeatherData(settings: Pick<PanelSettings, 'weather'>): Promise<WeatherResponse> {
  const city = settings.weather?.city?.trim() ?? '';
  const unit = settings.weather?.unit === 'imperial' ? 'imperial' : 'metric';

  if (!city) {
    return { configured: false, unit };
  }

  const apiKey = OW_KEY();
  if (!apiKey) {
    return {
      configured: true,
      unit,
      error: 'NEXT_PUBLIC_WEATHER_API_KEY fehlt in der Frontend-.env',
    };
  }

  try {
    const currentUrl = new URL('https://api.openweathermap.org/data/2.5/weather');
    currentUrl.searchParams.set('q', city);
    currentUrl.searchParams.set('appid', apiKey);
    currentUrl.searchParams.set('units', unit);
    currentUrl.searchParams.set('lang', 'de');

    const currentRes = await fetch(currentUrl, { next: { revalidate: 300 } });
    if (currentRes.status === 401) {
      return { configured: true, unit, error: 'Ungültiger API-Key' };
    }
    if (currentRes.status === 404) {
      return { configured: true, unit, error: 'Stadt nicht gefunden' };
    }
    if (!currentRes.ok) {
      return { configured: true, unit, error: `Wetter-API Fehler HTTP ${currentRes.status}` };
    }

    const c = (await currentRes.json()) as OwCurrent;
    const current = {
      temp: Math.round(c.main?.temp ?? 0),
      feelsLike: Math.round(c.main?.feels_like ?? 0),
      tempMin: Math.round(c.main?.temp_min ?? 0),
      tempMax: Math.round(c.main?.temp_max ?? 0),
      humidity: c.main?.humidity ?? 0,
      pressure: c.main?.pressure ?? 0,
      windSpeed: windSpeed(c.wind?.speed ?? 0, unit),
      windDeg: c.wind?.deg ?? null,
      clouds: c.clouds?.all ?? 0,
      visibility: c.visibility != null ? Math.round(c.visibility / 1000) : null,
      description: c.weather?.[0]?.description ?? '',
      icon: c.weather?.[0]?.icon ?? '01d',
      city: c.name ?? city,
      sunrise: c.sys?.sunrise ? new Date(c.sys.sunrise * 1000).toISOString() : null,
      sunset: c.sys?.sunset ? new Date(c.sys.sunset * 1000).toISOString() : null,
    };

    let hourly: WeatherHourly[] = [];
    let daily: WeatherDaily[] = [];

    if (c.coord?.lat != null && c.coord?.lon != null) {
      const oneCall = await tryOneCall(c.coord.lat, c.coord.lon, unit, apiKey);
      if (oneCall) {
        hourly = oneCall.hourly;
        daily = oneCall.daily;
      } else {
        // Fallback: 5-Tage/3-Std-Forecast → 24 Stundenpunkte + Tagesaggregate
        const forecastUrl = new URL('https://api.openweathermap.org/data/2.5/forecast');
        forecastUrl.searchParams.set('lat', String(c.coord.lat));
        forecastUrl.searchParams.set('lon', String(c.coord.lon));
        forecastUrl.searchParams.set('appid', apiKey);
        forecastUrl.searchParams.set('units', unit);
        forecastUrl.searchParams.set('lang', 'de');

        const forecastRes = await fetch(forecastUrl, { next: { revalidate: 300 } });
        if (forecastRes.ok) {
          const fj = await forecastRes.json() as {
            list?: OwForecastItem[];
            city?: { timezone?: number };
          };
          const nowSec = Math.floor(Date.now() / 1000);
          hourly = hourlyFrom3hForecast(fj.list ?? [], unit, nowSec);
          daily = dailyFrom3hForecast(fj.list ?? [], unit, fj.city?.timezone ?? 0);
        }
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
