'use client';

import Link from 'next/link';
import { Zap } from 'lucide-react';
import { api, type EnergyOverview } from '@/lib/api';
import { useStaleWhileRevalidate } from '@/hooks/useStaleWhileRevalidate';
import { useKiosk } from '@/components/KioskProvider';
import { cn } from '@/lib/utils';

interface Props {
  initial?: EnergyOverview | null;
}

function formatKwh(v: number): string {
  if (v < 0.01) return '0';
  if (v < 1) return v.toFixed(2);
  return v.toFixed(1);
}

function formatEuro(v: number): string {
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export default function EnergyWidget({ initial = null }: Props) {
  const { kioskMode } = useKiosk();
  const pad = kioskMode ? 'p-3' : 'p-4';
  const { data, loading } = useStaleWhileRevalidate(
    'dash-energy',
    api.getEnergy,
    60_000,
    initial,
  );

  if (loading && !data) {
    return (
      <div className={cn('rounded-2xl border bg-card animate-pulse space-y-3', pad)}>
        <div className="h-4 bg-muted rounded w-24" />
        <div className="h-10 bg-muted rounded w-full" />
      </div>
    );
  }

  const configured = data?.configured ?? false;

  if (!configured) {
    return (
      <div className="rounded-2xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <Zap className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Noch keine Energiedaten</p>
          <p className="text-xs">
            Sobald Stecker Leistung melden (oder Sampling läuft), erscheint die Übersicht.{' '}
            <Link href="/settings?view=widgets" className="text-primary underline underline-offset-2">
              Strompreis einstellen
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/energy"
      className={cn('block rounded-2xl border bg-card hover:bg-accent/40 transition-colors active:scale-[0.99]', pad)}
    >
      <div className={cn('flex items-center gap-2', kioskMode ? 'mb-2' : 'mb-3')}>
        <Zap className="h-5 w-5 text-amber-500 shrink-0" />
        <h2 className="text-sm font-semibold">Energie</h2>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Live</p>
          <p className={cn('font-bold tabular-nums leading-tight', kioskMode ? 'text-lg' : 'text-xl')}>
            {Math.round(data?.live_power_w ?? 0)}
            <span className="text-sm font-medium text-muted-foreground ml-0.5">W</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Heute</p>
          <p className={cn('font-bold tabular-nums leading-tight', kioskMode ? 'text-lg' : 'text-xl')}>
            {formatEuro(data?.today_cost ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
            {formatKwh(data?.today_kwh ?? 0)} kWh
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Monat</p>
          <p className={cn('font-bold tabular-nums leading-tight', kioskMode ? 'text-lg' : 'text-xl')}>
            {formatEuro(data?.month_cost ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
            {formatKwh(data?.month_kwh ?? 0)} kWh
          </p>
        </div>
      </div>
    </Link>
  );
}
