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

function buildSeries(
  list: OwForecastItem[],
  unit: string,
  tzOffset: number,
): { hourly: WeatherHourly[]; daily: WeatherDaily[] } {
  const today = ymdUtc(Date.now() + tzOffset * 1000);
  const hourly: WeatherHourly[] = [];
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
    const dt = item.dt;
    const localMs = (dt + tzOffset) * 1000;
    const dayKey = ymdUtc(localMs);
    const temp = item.main?.temp ?? 0;
    const tempMin = item.main?.temp_min ?? temp;
    const tempMax = item.main?.temp_max ?? temp;
    const icon = item.weather?.[0]?.icon ?? '01d';
    const description = item.weather?.[0]?.description ?? '';
    const pop = item.pop ?? 0;
    const humidity = item.main?.humidity ?? 0;
    const ws = windSpeed(item.wind?.speed ?? 0, unit);

    if (dayKey === today && hourly.length < 8) {
      hourly.push({
        time: new Date(dt * 1000).toISOString(),
        temp: Math.round(temp),
        icon,
        description,
        pop: Math.round(pop * 100),
        humidity,
        windSpeed: ws,
      });
    }

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

  const daily: WeatherDaily[] = [...byDay.values()].slice(0, 7).map(d => ({
    date: d.date,
    tempMin: Math.round(d.tempMin),
    tempMax: Math.round(d.tempMax),
    icon: d.icon,
    description: d.description,
    pop: Math.round(d.pop * 100),
    humidity: Math.round(d.humiditySum / Math.max(1, d.humidityN)),
    windSpeed: d.windMax,
  }));

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
        const built = buildSeries(fj.list ?? [], unit, fj.city?.timezone ?? 0);
        hourly = built.hourly;
        daily = built.daily;
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
