'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { api, type CalendarEvent, type CalendarEventsResponse } from '@/lib/api';
import CalendarMonthGrid from '@/components/CalendarMonthGrid';
import { isoDate, startOfLocalDay } from '@/lib/calendar-layout';

interface Props {
  initial?: CalendarEventsResponse | null;
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(year, month, 1);
  from.setDate(from.getDate() - 7);
  const to = new Date(year, month + 1, 0);
  to.setDate(to.getDate() + 7);
  return { from: isoDate(from), to: isoDate(to) };
}

export default function CalendarWidget({ initial = null }: Props) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = startOfLocalDay(now);
  const monthTitle = new Date(year, month, 1).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });

  const [events, setEvents] = useState<CalendarEvent[]>(initial?.events ?? []);
  const [configured, setConfigured] = useState(initial?.configured ?? false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [loading, setLoading] = useState(!initial);

  const load = useCallback(async () => {
    try {
      const res = await api.getCalendarEvents(monthRange(year, month));
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
  }, [year, month]);

  useEffect(() => {
    if (!initial) void load();
    const t = setInterval(load, 15 * 60_000);
    return () => clearInterval(t);
  }, [load, initial]);

  if (loading && events.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-5 animate-pulse space-y-3">
        <div className="h-4 bg-muted rounded w-28" />
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
    );
  }

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

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-3 sm:p-4">
      <Link href="/calendar" className="flex items-center gap-2 min-w-0 mb-2 hover:opacity-80 transition-opacity">
        <CalendarDays className="h-5 w-5 text-violet-500 shrink-0" />
        <p className="font-semibold text-sm">Kalender</p>
        <span className="text-xs text-muted-foreground capitalize truncate">{monthTitle}</span>
      </Link>
      <Link href="/calendar" className="block hover:opacity-95 transition-opacity">
        <CalendarMonthGrid
          year={year}
          month={month}
          events={events}
          today={today}
        />
      </Link>
    </div>
  );
}
