'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TrainFront } from 'lucide-react';
import {
  api,
  type TransitBoardResponse,
  type TransitDeparture,
  type TransitJourney,
} from '@/lib/api';
import { cn } from '@/lib/utils';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function delayLabel(delaySec: number | null | undefined): string | null {
  if (delaySec == null || delaySec === 0) return null;
  const min = Math.round(delaySec / 60);
  if (min === 0) return null;
  return min > 0 ? `+${min}` : `${min}`;
}

function JourneyRow({ journey }: { journey: TransitJourney }) {
  const delay = delayLabel(journey.delay);
  const lines = journey.legs.map(l => l.line).filter(Boolean).join(' · ');

  return (
    <div className={cn('flex items-start gap-3 py-2', journey.cancelled && 'opacity-50 line-through')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium tabular-nums">
          Ab {formatTime(journey.departure)}
          <span className="text-muted-foreground font-normal"> → </span>
          An {formatTime(journey.arrival)}
          {delay && (
            <span className={cn(
              'ml-1.5 text-xs font-semibold',
              (journey.delay ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600',
            )}>
              {delay}′
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {journey.durationMin != null ? `${journey.durationMin} Min` : '—'}
          {' · '}
          {journey.changes === 0 ? 'Direkt' : `${journey.changes} Umstieg${journey.changes === 1 ? '' : 'e'}`}
          {lines ? ` · ${lines}` : ''}
        </p>
      </div>
    </div>
  );
}

function DepartureRow({ dep }: { dep: TransitDeparture }) {
  const delay = delayLabel(dep.delay);
  return (
    <div className={cn(
      'grid grid-cols-[3.5rem_1fr_auto] gap-2 items-center py-1.5 text-sm',
      dep.cancelled && 'opacity-50 line-through',
    )}>
      <span className="font-semibold truncate tabular-nums">{dep.line}</span>
      <span className="truncate text-muted-foreground">{dep.direction || '—'}</span>
      <span className="tabular-nums text-right whitespace-nowrap">
        {formatTime(dep.when)}
        {delay && (
          <span className={cn(
            'ml-1 text-xs font-semibold',
            (dep.delay ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600',
          )}>
            {delay}′
          </span>
        )}
        {dep.platform && (
          <span className="ml-1.5 text-xs text-muted-foreground">Gl. {dep.platform}</span>
        )}
      </span>
    </div>
  );
}

interface Props {
  initial?: TransitBoardResponse | null;
}

export default function TransitWidget({ initial = null }: Props) {
  const [board, setBoard] = useState<TransitBoardResponse | null>(initial);
  const [loading, setLoading] = useState(!initial);

  const load = useCallback(async () => {
    try {
      const res = await api.getTransitBoard();
      setBoard(res);
    } catch (e) {
      setBoard(prev => prev ?? {
        configured: false,
        stations: [],
        connections: [],
        error: e instanceof Error ? e.message : 'Bahn nicht ladbar',
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

  if (loading && !board) {
    return (
      <div className="rounded-2xl border bg-card p-4 animate-pulse space-y-3">
        <div className="h-4 bg-muted rounded w-24" />
        <div className="h-10 bg-muted rounded w-full" />
      </div>
    );
  }

  const configured = board?.configured ?? false;
  const connections = board?.connections ?? [];
  const stations = board?.stations ?? [];
  const error = board?.error ?? null;

  if (!configured) {
    return (
      <div className="rounded-2xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <TrainFront className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Bahn noch nicht eingerichtet</p>
          <Link href="/settings?view=widgets" className="text-xs text-primary underline underline-offset-2">
            Stationen oder Verbindungen in Einstellungen →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <TrainFront className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
        <h2 className="text-sm font-semibold">Bahn</h2>
      </div>

      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>
      )}

      {connections.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Verbindungen</p>
          {connections.map(conn => (
            <div key={conn.id} className="rounded-xl border bg-background/50 px-3 py-2">
              <p className="text-sm font-semibold truncate">{conn.label}</p>
              <p className="text-[11px] text-muted-foreground truncate mb-1">
                {conn.from.name} → {conn.to.name}
              </p>
              {conn.error && <p className="text-xs text-destructive">{conn.error}</p>}
              {conn.journeys.length === 0 && !conn.error && (
                <p className="text-xs text-muted-foreground py-1">Keine Verbindungen gefunden</p>
              )}
              <div className="divide-y">
                {conn.journeys.slice(0, 2).map((j, i) => (
                  <JourneyRow key={`${conn.id}-${j.departure}-${i}`} journey={j} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {stations.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stationen</p>
          {stations.map(st => (
            <div key={st.stop.id} className="rounded-xl border bg-background/50 px-3 py-2">
              <p className="text-sm font-semibold truncate mb-1">{st.stop.name}</p>
              {st.error && <p className="text-xs text-destructive">{st.error}</p>}
              {st.departures.length === 0 && !st.error && (
                <p className="text-xs text-muted-foreground py-1">Keine Abfahrten</p>
              )}
              <div className="divide-y">
                {st.departures.map((d, i) => (
                  <DepartureRow key={`${st.stop.id}-${d.when}-${d.line}-${i}`} dep={d} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
