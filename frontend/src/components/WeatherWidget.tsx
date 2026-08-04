'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, Sun, Wind, Droplets, Thermometer, Settings } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'smarthome_weather_cfg';
const ENV_KEY     = process.env.NEXT_PUBLIC_WEATHER_API_KEY ?? '';

interface WeatherConfig { apiKey: string; city: string; unit: 'metric' | 'imperial' }
interface WeatherData {
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  description: string;
  icon: string;
  city: string;
}

function loadConfig(): WeatherConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored: Partial<WeatherConfig> = raw ? JSON.parse(raw) : {};
    const apiKey = stored.apiKey?.trim() || ENV_KEY;
    const city   = stored.city?.trim() ?? '';
    if (!apiKey) return null;
    return { apiKey, city, unit: stored.unit ?? 'metric' };
  } catch { return null; }
}

function WeatherIcon({ icon, className }: { icon: string; className?: string }) {
  const cls = cn('shrink-0', className);
  if (icon.includes('01')) return <Sun className={cls} />;
  if (icon.includes('09') || icon.includes('10')) return <CloudRain className={cls} />;
  if (icon.includes('13')) return <CloudSnow className={cls} />;
  if (icon.includes('50')) return <Wind className={cls} />;
  return <Cloud className={cls} />;
}

export default function WeatherWidget() {
  const [cfg, setCfg]     = useState<WeatherConfig | null>(null);
  const [data, setData]   = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCfg(loadConfig());
  }, []);

  useEffect(() => {
    if (!cfg?.apiKey || !cfg?.city) return;
    setLoading(true);
    setError(null);

    const unit = cfg.unit ?? 'metric';
    fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cfg.city)}&appid=${cfg.apiKey}&units=${unit}&lang=de`
    )
      .then(r => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Ungültiger API-Key' : r.status === 404 ? 'Stadt nicht gefunden' : `Fehler ${r.status}`);
        return r.json();
      })
      .then(d => setData({
        temp:        Math.round(d.main.temp),
        feelsLike:   Math.round(d.main.feels_like),
        humidity:    d.main.humidity,
        windSpeed:   Math.round(d.wind.speed * 3.6), // m/s → km/h
        description: d.weather[0].description,
        icon:        d.weather[0].icon,
        city:        d.name,
      }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [cfg]);

  if (!mounted) return null;

  // Nicht konfiguriert
  if (!cfg?.apiKey || !cfg?.city) {
    return (
      <div className="rounded-xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <Cloud className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Stadt noch nicht eingestellt</p>
          <Link href="/settings" className="text-xs text-primary underline underline-offset-2">
            Stadt in Einstellungen eingeben →
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-card p-5 flex items-center gap-3 animate-pulse">
        <Cloud className="h-8 w-8 text-muted-foreground/30 shrink-0" />
        <div className="space-y-1.5 flex-1">
          <div className="h-4 bg-muted rounded w-24" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 flex items-center justify-between gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/settings" className="shrink-0">
          <Settings className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const unit = cfg.unit === 'imperial' ? '°F' : '°C';
  const windUnit = cfg.unit === 'imperial' ? 'mph' : 'km/h';

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <WeatherIcon icon={data.icon} className="h-10 w-10 text-amber-500" />
          <div className="min-w-0">
            <p className="text-3xl font-bold tabular-nums leading-none">
              {data.temp}{unit}
            </p>
            <p className="text-xs text-muted-foreground capitalize mt-0.5 truncate">
              {data.city} · {data.description}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Thermometer className="h-3 w-3" />
            Gefühlt {data.feelsLike}{unit}
          </span>
          <span className="flex items-center gap-1">
            <Droplets className="h-3 w-3" />
            {data.humidity}%
          </span>
          <span className="flex items-center gap-1">
            <Wind className="h-3 w-3" />
            {data.windSpeed} {windUnit}
          </span>
        </div>
      </div>
    </div>
  );
}
