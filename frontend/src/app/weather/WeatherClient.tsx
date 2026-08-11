'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Cloud, Droplets, Sunrise, Sunset, Thermometer, Wind, Eye, Gauge } from 'lucide-react';
import { WeatherIcon } from '@/components/WeatherWidget';
import type { WeatherResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  initial: WeatherResponse;
}

function unitSymbol(unit: string): string {
  return unit === 'imperial' ? '°F' : '°C';
}

function windLabel(unit: string): string {
  return unit === 'imperial' ? 'mph' : 'km/h';
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === tomorrow.toDateString()) return 'Morgen';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function WeatherClient({ initial }: Props) {
  const router = useRouter();
  const unit = unitSymbol(initial.unit ?? 'metric');
  const wUnit = windLabel(initial.unit ?? 'metric');
  const current = initial.current;
  const hourly = initial.hourly ?? [];
  const daily = initial.daily ?? [];

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 animate-page-in">
      <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 flex items-center gap-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="cursor-pointer h-14 w-14 rounded-full flex items-center justify-center bg-muted hover:bg-accent transition-colors shrink-0 active:scale-90"
          aria-label="Zurück"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight truncate">Wetter</h1>
          <p className="text-sm text-muted-foreground truncate">
            {current?.city ?? 'Details'}
          </p>
        </div>
      </div>

      {!initial.configured && (
        <div className="rounded-2xl border bg-card p-5 text-muted-foreground">
          <p className="text-sm font-medium">Stadt noch nicht eingestellt</p>
          <Link href="/settings?view=widgets" className="text-xs text-primary underline underline-offset-2">
            Einstellungen → Widgets
          </Link>
        </div>
      )}

      {initial.error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm text-destructive">{initial.error}</p>
        </div>
      )}

      {current && (
        <div className="rounded-2xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-4">
            <WeatherIcon icon={current.icon} className="h-16 w-16 text-amber-500" />
            <div className="min-w-0">
              <p className="text-5xl font-bold tabular-nums leading-none">{current.temp}{unit}</p>
              <p className="text-sm text-muted-foreground capitalize mt-1">{current.description}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {current.tempMin}{unit} – {current.tempMax}{unit}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <InfoChip icon={<Thermometer className="h-3.5 w-3.5" />} label="Gefühlt" value={`${current.feelsLike}${unit}`} />
            <InfoChip icon={<Droplets className="h-3.5 w-3.5" />} label="Luftfeuchte" value={`${current.humidity}%`} />
            <InfoChip icon={<Wind className="h-3.5 w-3.5" />} label="Wind" value={`${current.windSpeed} ${wUnit}`} />
            <InfoChip icon={<Gauge className="h-3.5 w-3.5" />} label="Druck" value={`${current.pressure} hPa`} />
            <InfoChip icon={<Cloud className="h-3.5 w-3.5" />} label="Wolken" value={`${current.clouds}%`} />
            {current.visibility != null && (
              <InfoChip icon={<Eye className="h-3.5 w-3.5" />} label="Sicht" value={`${current.visibility} km`} />
            )}
            <InfoChip icon={<Sunrise className="h-3.5 w-3.5" />} label="Sonnenaufgang" value={formatClock(current.sunrise)} />
            <InfoChip icon={<Sunset className="h-3.5 w-3.5" />} label="Sonnenuntergang" value={formatClock(current.sunset)} />
          </div>
        </div>
      )}

      {hourly.length > 0 && (
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <p className="text-sm font-semibold mb-3">Tagesverlauf</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {hourly.map(h => (
              <div
                key={h.time}
                className="flex-shrink-0 w-[4.5rem] rounded-xl bg-muted/50 px-2 py-3 flex flex-col items-center gap-1.5"
              >
                <span className="text-[11px] text-muted-foreground tabular-nums">{formatClock(h.time)}</span>
                <WeatherIcon icon={h.icon} className="h-6 w-6 text-amber-500" />
                <span className="text-sm font-semibold tabular-nums">{h.temp}{unit}</span>
                <span className="text-[10px] text-sky-600 dark:text-sky-400 tabular-nums">{h.pop}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {daily.length > 0 && (
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <p className="text-sm font-semibold mb-3">Wochenverlauf</p>
          <ul className="divide-y">
            {daily.map(d => (
              <li key={d.date} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-24 text-sm font-medium shrink-0">{formatDay(d.date)}</span>
                <WeatherIcon icon={d.icon} className="h-6 w-6 text-amber-500 shrink-0" />
                <span className="text-xs text-muted-foreground capitalize flex-1 min-w-0 truncate">{d.description}</span>
                <span className="text-xs text-sky-600 dark:text-sky-400 tabular-nums w-10 text-right shrink-0">{d.pop}%</span>
                <span className="text-sm tabular-nums shrink-0 w-[4.5rem] text-right">
                  <span className="text-muted-foreground">{d.tempMin}°</span>
                  {' '}
                  <span className="font-semibold">{d.tempMax}°</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InfoChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className={cn('rounded-xl bg-muted/50 px-3 py-2.5 flex flex-col gap-0.5')}>
      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
