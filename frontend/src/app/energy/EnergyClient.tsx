'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Zap } from 'lucide-react';
import {
  api,
  type EnergyHistoryResponse,
  type EnergyOverview,
  type EnergyPeriod,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Props {
  initial: EnergyOverview;
  initialHistory: EnergyHistoryResponse;
}

const PERIODS: { id: EnergyPeriod; label: string }[] = [
  { id: 'day', label: 'Heute' },
  { id: 'week', label: 'Woche' },
  { id: 'month', label: 'Monat' },
  { id: 'year', label: 'Jahr' },
];

const PREV_LABEL: Record<EnergyPeriod, string> = {
  day: 'vs. gestern',
  week: 'vs. Vorwoche',
  month: 'vs. Vormonat',
  year: 'vs. Vorjahr',
};

function formatKwh(v: number): string {
  if (v < 0.01) return '0';
  if (v < 1) return v.toFixed(2);
  return v.toFixed(1);
}

function formatEuro(v: number): string {
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function periodStats(data: EnergyOverview, period: EnergyPeriod) {
  switch (period) {
    case 'week':
      return {
        kwh: data.week_kwh ?? 0,
        cost: data.week_cost ?? 0,
        prevKwh: data.prev_week_kwh ?? 0,
        prevCost: data.prev_week_cost ?? 0,
      };
    case 'month':
      return {
        kwh: data.month_kwh ?? 0,
        cost: data.month_cost ?? 0,
        prevKwh: data.prev_month_kwh ?? 0,
        prevCost: data.prev_month_cost ?? 0,
      };
    case 'year':
      return {
        kwh: data.year_kwh ?? 0,
        cost: data.year_cost ?? 0,
        prevKwh: data.prev_year_kwh ?? 0,
        prevCost: data.prev_year_cost ?? 0,
      };
    default:
      return {
        kwh: data.today_kwh ?? 0,
        cost: data.today_cost ?? 0,
        prevKwh: data.prev_today_kwh ?? 0,
        prevCost: data.prev_today_cost ?? 0,
      };
  }
}

function formatDelta(kwh: number, prevKwh: number, cost: number, prevCost: number, period: EnergyPeriod): string | null {
  if (prevKwh <= 0 && prevCost <= 0) return null;
  const dKwh = kwh - prevKwh;
  const dCost = cost - prevCost;
  const pct = prevKwh > 0 ? (dKwh / prevKwh) * 100 : null;
  const pctStr = pct === null
    ? ''
    : `${pct > 0.5 ? '+' : ''}${pct.toFixed(0)} %`;
  const costStr = `${dCost > 0.004 ? '+' : ''}${formatEuro(dCost)}`;
  const parts = [pctStr, costStr].filter(Boolean);
  return `${PREV_LABEL[period]}: ${parts.join(' · ')}`;
}

function formatDataSince(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function showSinceCaption(dataSince: string | null | undefined, period: EnergyPeriod): boolean {
  if (!dataSince) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let start: Date;
  if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'week') {
    start = new Date(now);
    start.setDate(start.getDate() - 6);
  } else {
    return false;
  }
  const [y, m, d] = dataSince.split('-').map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d) > start;
}

function BarChart({
  buckets,
  valueKey,
}: {
  buckets: EnergyHistoryResponse['buckets'];
  valueKey: 'kwh' | 'cost';
}) {
  const values = buckets.map(b => b[valueKey]);
  const max = Math.max(...values, valueKey === 'cost' ? 0.01 : 0.001);

  return (
    <div className="flex items-end gap-1 h-36 w-full">
      {buckets.map((b, i) => {
        const v = b[valueKey];
        const h = Math.max(2, (v / max) * 100);
        const tip = valueKey === 'cost'
          ? `${b.label}: ${formatEuro(v)}`
          : `${b.label}: ${formatKwh(v)} kWh`;
        return (
          <div key={`${b.start}-${i}`} className="flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end">
            <div
              className="w-full rounded-t-md bg-amber-500/80 dark:bg-amber-400/70"
              style={{ height: `${h}%` }}
              title={tip}
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
  const [period, setPeriod] = useState<EnergyPeriod>(initialHistory.range ?? 'day');
  const [chartUnit, setChartUnit] = useState<'kwh' | 'cost'>('kwh');
  const [loadingHist, setLoadingHist] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ov, hist] = await Promise.all([
        api.getEnergy(),
        api.getEnergyHistory(period),
      ]);
      setData(ov);
      setHistory(hist);
    } catch { /* */ }
  }, [period]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoadingHist(true);
    api.getEnergyHistory(period)
      .then(h => { if (!cancelled) setHistory(h); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingHist(false); });
    return () => { cancelled = true; };
  }, [period]);

  const stats = periodStats(data, period);
  const delta = formatDelta(stats.kwh, stats.prevKwh, stats.cost, stats.prevCost, period);
  const byDevice = data.by_device?.[period] ?? (period === 'day' ? (data.by_device_today ?? []) : []);
  const dataSince = data.data_since ?? history.data_since ?? null;
  const sinceCaption = useMemo(
    () => (showSinceCaption(dataSince, period) && dataSince
      ? `Daten seit ${formatDataSince(dataSince)}`
      : null),
    [dataSince, period],
  );

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

      <div className="grid grid-cols-4 gap-1 rounded-2xl border bg-card p-1">
        {PERIODS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={cn(
              'h-9 rounded-xl text-sm font-medium transition-colors',
              period === p.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!data.configured && (
        <div className="rounded-2xl border bg-card p-5 text-muted-foreground">
          <p className="text-sm font-medium">Noch keine Energiedaten</p>
          <Link href="/settings?view=widgets" className="text-xs text-primary underline underline-offset-2">
            Strompreis in Widgets einstellen →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Live</p>
          <p className="text-lg font-bold tabular-nums mt-1">
            {Math.round(data.live_power_w)} W
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Verbrauch</p>
          <p className="text-lg font-bold tabular-nums mt-1">
            {formatKwh(stats.kwh)} kWh
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Kosten</p>
          <p className="text-lg font-bold tabular-nums mt-1">
            {formatEuro(stats.cost)}
          </p>
        </div>
      </div>
      {delta || sinceCaption ? (
        <div className="-mt-2 px-1 space-y-0.5">
          {delta && <p className="text-xs text-muted-foreground">{delta}</p>}
          {sinceCaption && <p className="text-xs text-muted-foreground">{sinceCaption}</p>}
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold flex-1">Verlauf</p>
          <div className="flex gap-1">
            <Button size="sm" variant={chartUnit === 'kwh' ? 'default' : 'outline'} onClick={() => setChartUnit('kwh')}>
              kWh
            </Button>
            <Button size="sm" variant={chartUnit === 'cost' ? 'default' : 'outline'} onClick={() => setChartUnit('cost')}>
              €
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
          <BarChart buckets={history.buckets} valueKey={chartUnit} />
        )}
      </div>

      {byDevice.length > 0 && (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">
            Nach Gerät
          </p>
          <ul className="divide-y">
            {byDevice.map(d => (
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
