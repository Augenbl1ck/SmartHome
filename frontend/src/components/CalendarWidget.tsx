'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Settings } from 'lucide-react';
import { api, type CalendarEvent } from '@/lib/api';
import { cn } from '@/lib/utils';

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
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

export default function CalendarWidget({ compact = false }: { compact?: boolean }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = startOfLocalDay();
      const to = new Date(from);
      to.setDate(to.getDate() + 14);
      const res = await api.getCalendarEvents({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
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
    setMounted(true);
    load();
    const t = setInterval(load, 15 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!mounted) return null;

  const now = new Date();
  const upcoming = events.filter(ev => {
    const end = ev.end ? new Date(ev.end) : new Date(ev.start);
    return end >= now || (ev.all_day && isSameDay(new Date(ev.start), startOfLocalDay(now)));
  });
  const todayEvents = upcoming.filter(ev => isSameDay(new Date(ev.start), startOfLocalDay(now)));
  const nextUp = upcoming.slice(0, compact ? 2 : 6);

  if (compact) {
    if (!configured || nextUp.length === 0) return null;
    const first = nextUp[0];
    return (
      <div className="flex items-center gap-2 text-sm min-w-0 max-w-[180px]">
        <CalendarDays className="h-4 w-4 text-violet-500 shrink-0" />
        <span className="truncate font-medium">{first.title}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums text-xs">
          {first.all_day ? 'heute' : formatTime(first.start)}
        </span>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-2xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <CalendarDays className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Kalender noch nicht eingerichtet</p>
          <Link href="/settings?view=calendar" className="text-xs text-primary underline underline-offset-2">
            FamilyWall iCal-URL in Einstellungen →
          </Link>
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
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 flex items-center justify-between gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/settings?view=calendar" className="shrink-0">
          <Settings className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </Link>
      </div>
    );
  }

  let lastDayKey = '';

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="h-5 w-5 text-violet-500 shrink-0" />
          <p className="font-semibold text-sm">Kalender</p>
          {todayEvents.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {todayEvents.length} heute
            </span>
          )}
        </div>
        <Link href="/settings?view=calendar" className="text-muted-foreground hover:text-foreground">
          <Settings className="h-4 w-4" />
        </Link>
      </div>

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
                  isSameDay(day, startOfLocalDay(now)) && 'bg-violet-500/8',
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
