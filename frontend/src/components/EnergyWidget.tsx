'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { api, type EnergyOverview } from '@/lib/api';

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
  const [data, setData] = useState<EnergyOverview | null>(initial);
  const [loading, setLoading] = useState(!initial);

  const load = useCallback(async () => {
    try {
      const res = await api.getEnergy();
      setData(res);
    } catch (e) {
      setData(prev => prev ?? {
        configured: false,
        price_per_kwh: 0.3,
        live_power_w: 0,
        today_kwh: 0,
        week_kwh: 0,
        today_cost: 0,
        week_cost: 0,
        devices: [],
        by_device_today: [],
        error: e instanceof Error ? e.message : 'Energie nicht ladbar',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="rounded-2xl border bg-card p-4 animate-pulse space-y-3">
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
      className="block rounded-2xl border bg-card p-4 hover:bg-accent/40 transition-colors active:scale-[0.99]"
    >
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-5 w-5 text-amber-500 shrink-0" />
        <h2 className="text-sm font-semibold">Energie</h2>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Live</p>
          <p className="text-xl font-bold tabular-nums leading-tight">
            {Math.round(data?.live_power_w ?? 0)}
            <span className="text-sm font-medium text-muted-foreground ml-0.5">W</span>
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Heute</p>
          <p className="text-xl font-bold tabular-nums leading-tight">
            {formatKwh(data?.today_kwh ?? 0)}
            <span className="text-sm font-medium text-muted-foreground ml-0.5">kWh</span>
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Kosten</p>
          <p className="text-xl font-bold tabular-nums leading-tight">
            {formatEuro(data?.today_cost ?? 0)}
          </p>
        </div>
      </div>
    </Link>
  );
}
