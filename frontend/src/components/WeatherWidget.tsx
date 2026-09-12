'use client';

import Link from 'next/link';
import { Cloud, CloudRain, CloudSnow, Sun, Wind, Droplets, Thermometer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, type WeatherCurrent, type WeatherResponse } from '@/lib/api';
import { useStaleWhileRevalidate } from '@/hooks/useStaleWhileRevalidate';
import { useKiosk } from '@/components/KioskProvider';

function WeatherIcon({ icon, className }: { icon: string; className?: string }) {
  const cls = cn('shrink-0', className);
  if (icon.includes('01')) return <Sun className={cls} />;
  if (icon.includes('09') || icon.includes('10')) return <CloudRain className={cls} />;
  if (icon.includes('11')) return <CloudRain className={cls} />;
  if (icon.includes('13')) return <CloudSnow className={cls} />;
  if (icon.includes('50')) return <Wind className={cls} />;
  return <Cloud className={cls} />;
}

export { WeatherIcon };

interface Props {
  initial?: WeatherResponse | null;
  compact?: boolean;
}

function unitSymbol(unit: string): string {
  return unit === 'imperial' ? '°F' : '°C';
}

function windLabel(unit: string): string {
  return unit === 'imperial' ? 'mph' : 'km/h';
}

export default function WeatherWidget({ initial = null, compact = false }: Props) {
  const { kioskMode } = useKiosk();
  const pad = kioskMode ? 'p-3' : 'p-5';
  const { data: weather, error: loadError } = useStaleWhileRevalidate(
    'dash-weather',
    api.getWeather,
    10 * 60_000,
    initial,
  );

  const configured = weather?.configured ?? false;
  const error = weather?.error ?? loadError;
  const data: WeatherCurrent | null = weather?.current ?? null;
  const unit = unitSymbol(weather?.unit ?? 'metric');
  const wUnit = windLabel(weather?.unit ?? 'metric');

  if (compact) {
    if (!data) return null;
    return (
      <div className="flex items-center gap-2 text-sm">
        <WeatherIcon icon={data.icon} className="h-5 w-5 text-amber-500" />
        <span className="font-semibold tabular-nums">{data.temp}{unit}</span>
        <span className="text-muted-foreground hidden sm:inline truncate max-w-[80px]">{data.city}</span>
      </div>
    );
  }

  if (!weather) {
    if (error) {
      return (
        <div className={cn('rounded-2xl border border-destructive/30 bg-destructive/5', pad)}>
          <p className="text-sm text-destructive">{error}</p>
        </div>
      );
    }
    return (
      <div className={cn('rounded-2xl border bg-card flex items-center gap-3 animate-pulse', pad)}>
        <Cloud className="h-8 w-8 text-muted-foreground/30 shrink-0" />
        <div className="space-y-1.5 flex-1">
          <div className="h-4 bg-muted rounded w-24" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-2xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <Cloud className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Stadt noch nicht eingestellt</p>
          <Link href="/settings?view=widgets" className="text-xs text-primary underline underline-offset-2">
            Stadt in Einstellungen eingeben →
          </Link>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={cn('rounded-2xl border border-destructive/30 bg-destructive/5', pad)}>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={cn('rounded-2xl border bg-card flex items-center gap-3 animate-pulse', pad)}>
        <Cloud className="h-8 w-8 text-muted-foreground/30 shrink-0" />
        <div className="space-y-1.5 flex-1">
          <div className="h-4 bg-muted rounded w-24" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/weather"
      className={cn('block rounded-2xl border bg-card transition-colors hover:bg-accent/40 active:scale-[0.99]', pad)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <WeatherIcon icon={data.icon} className={cn(kioskMode ? 'h-8 w-8' : 'h-10 w-10', 'text-amber-500')} />
          <div className="min-w-0">
            <p className={cn('font-bold tabular-nums leading-none', kioskMode ? 'text-2xl' : 'text-3xl')}>
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
            {data.windSpeed} {wUnit}
          </span>
        </div>
      </div>
    </Link>
  );
}
