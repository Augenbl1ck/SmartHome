'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Zap } from 'lucide-react';
import { api, type EnergyHistoryResponse, type EnergyOverview } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Props {
  initial: EnergyOverview;
  initialHistory: EnergyHistoryResponse;
}

function formatKwh(v: number): string {
  if (v < 0.01) return '0';
  if (v < 1) return v.toFixed(2);
  return v.toFixed(1);
}

function formatEuro(v: number): string {
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function BarChart({ buckets, valueKey }: { buckets: EnergyHistoryResponse['buckets']; valueKey: 'kwh' | 'avg_w' }) {
  const values = buckets.map(b => b[valueKey]);
  const max = Math.max(...values, 0.001);

  return (
    <div className="flex items-end gap-1 h-36 w-full">
      {buckets.map((b, i) => {
        const v = b[valueKey];
        const h = Math.max(2, (v / max) * 100);
        return (
          <div key={`${b.start}-${i}`} className="flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end">
            <div
              className="w-full rounded-t-md bg-amber-500/80 dark:bg-amber-400/70"
              style={{ height: `${h}%` }}
              title={`${b.label}: ${valueKey === 'kwh' ? `${formatKwh(v)} kWh` : `${Math.round(v)} W`}`}
            />
            <span className="text-[9px] text-muted-foreground truncate w-full text-center leading-none">
              {b.label.replace(/\s.*/, '')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function EnergyClient({ initial, initialHistory }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [history, setHistory] = useState(initialHistory);
  const [range, setRange] = useState<'day' | 'week'>(initialHistory.range ?? 'day');
  const [loadingHist, setLoadingHist] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ov, hist] = await Promise.all([
        api.getEnergy(),
        api.getEnergyHistory(range),
      ]);
      setData(ov);
      setHistory(hist);
    } catch { /* */ }
  }, [range]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoadingHist(true);
    api.getEnergyHistory(range)
      .then(h => { if (!cancelled) setHistory(h); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingHist(false); });
    return () => { cancelled = true; };
  }, [range]);

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
          <h1 className="text-2xl font-bold leading-tight truncate">Energie</h1>
          <p className="text-sm text-muted-foreground truncate">
            {formatEuro(data.price_per_kwh)}/kWh
          </p>
        </div>
        <Zap className="h-6 w-6 text-amber-500 shrink-0" />
      </div>

      {!data.configured && (
        <div className="rounded-2xl border bg-card p-5 text-muted-foreground">
          <p className="text-sm font-medium">Noch keine Energiedaten</p>
          <Link href="/settings?view=widgets" className="text-xs text-primary underline underline-offset-2">
            Strompreis in Widgets einstellen →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Live', value: `${Math.round(data.live_power_w)} W` },
          { label: 'Heute', value: `${formatKwh(data.today_kwh)} kWh` },
          { label: 'Kosten heute', value: formatEuro(data.today_cost) },
          { label: 'Woche', value: `${formatKwh(data.week_kwh)} kWh` },
        ].map(c => (
          <div key={c.label} className="rounded-2xl border bg-card p-4">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{c.label}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold flex-1">Verbrauch</p>
          <div className="flex gap-1">
            <Button size="sm" variant={range === 'day' ? 'default' : 'outline'} onClick={() => setRange('day')}>
              Tag
            </Button>
            <Button size="sm" variant={range === 'week' ? 'default' : 'outline'} onClick={() => setRange('week')}>
              Woche
            </Button>
          </div>
        </div>
        {loadingHist ? (
          <div className="h-36 animate-pulse bg-muted rounded-xl" />
        ) : history.buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Noch keine Samples — Sampling läuft alle 5 Minuten.
          </p>
        ) : (
          <BarChart buckets={history.buckets} valueKey="kwh" />
        )}
      </div>

      {data.by_device_today.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">
            Heute nach Gerät
          </p>
          <ul className="divide-y">
            {data.by_device_today.map(d => (
              <li key={d.id} className="px-4 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{d.name}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-amber-500/80"
                      style={{ width: `${Math.round(d.share * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{formatKwh(d.kwh)} kWh</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatEuro(d.cost)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.devices.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">
            Live Leistung
          </p>
          <ul className="divide-y">
            {data.devices.map(d => (
              <li key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-sm truncate">{d.name}</span>
                <span className={cn(
                  'text-sm font-semibold tabular-nums',
                  d.power_w > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                )}>
                  {Math.round(d.power_w)} W
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
