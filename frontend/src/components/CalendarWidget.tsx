'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { api, type CalendarEvent, type CalendarEventsResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Local YYYY-MM-DD — toISOString() shifts the day in CET/CEST. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatDayLabel(d: Date): string {
  const today = startOfLocalDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(d, today)) return 'Heute';
  if (isSameDay(d, tomorrow)) return 'Morgen';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function eventTimeLabel(ev: CalendarEvent): string {
  if (ev.all_day) return 'Ganztägig';
  const start = formatTime(ev.start);
  if (!ev.end) return start;
  return `${start}–${formatTime(ev.end)}`;
}

interface Props {
  initial?: CalendarEventsResponse | null;
}

export default function CalendarWidget({ initial = null }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>(initial?.events ?? []);
  const [configured, setConfigured] = useState(initial?.configured ?? false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [loading, setLoading] = useState(!initial);

  const load = useCallback(async () => {
    try {
      const from = startOfLocalDay();
      const to = new Date(from);
      to.setDate(to.getDate() + 14);
      const res = await api.getCalendarEvents({
        from: isoDate(from),
        to: isoDate(to),
      });
      setConfigured(res.configured);
      setError(res.error ?? null);
      setEvents(res.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kalender nicht ladbar');
      setConfigured(false);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Always refresh on mount so RRULE expansions from the API are not stuck on stale SSR.
    void load();
    const t = setInterval(load, 15 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  const now = new Date();
  const today = startOfLocalDay(now);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 14);
  horizon.setHours(23, 59, 59, 999);

  // Like the full calendar: include all of today (even if already ended) + upcoming in range.
  const upcoming = events.filter(ev => {
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : start;
    return end >= today && start <= horizon;
  });
  const todayEvents = upcoming.filter(ev => {
    const start = startOfLocalDay(new Date(ev.start));
    const end = ev.end ? startOfLocalDay(new Date(ev.end)) : start;
    return start <= today && end >= today;
  });
  const nextUp = upcoming.slice(0, 8);

  if (!configured) {
    return (
      <div className="rounded-2xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <CalendarDays className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Kalender noch nicht eingerichtet</p>
          <p className="text-xs mt-0.5">Einstellungen → Widgets → iCal-URL</p>
        </div>
      </div>
    );
  }

  if (loading && events.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-5 animate-pulse space-y-3">
        <div className="h-4 bg-muted rounded w-28" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  let lastDayKey = '';

  return (
    <div className="rounded-2xl border bg-card p-5">
      <Link href="/calendar" className="flex items-center gap-2 min-w-0 mb-3 hover:opacity-80 transition-opacity">
        <CalendarDays className="h-5 w-5 text-violet-500 shrink-0" />
        <p className="font-semibold text-sm">Kalender</p>
        {todayEvents.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {todayEvents.length} heute
          </span>
        )}
      </Link>

      {nextUp.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Termine in den nächsten 14 Tagen</p>
      ) : (
        <ul className="space-y-2">
          {nextUp.map(ev => {
            const day = new Date(ev.start);
            const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const showDay = dayKey !== lastDayKey;
            lastDayKey = dayKey;
            return (
              <li key={ev.uid + ev.start}>
                {showDay && (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1 mt-1 first:mt-0">
                    {formatDayLabel(day)}
                  </p>
                )}
                <div className={cn(
                  'flex items-start gap-3 rounded-xl px-2.5 py-2',
                  isSameDay(day, today) && 'bg-violet-500/8',
                )}>
                  <span className="text-xs tabular-nums text-muted-foreground w-[4.5rem] shrink-0 pt-0.5">
                    {eventTimeLabel(ev)}
                  </span>
                  <span className="text-sm font-medium leading-snug min-w-0 break-words">
                    {ev.title}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
