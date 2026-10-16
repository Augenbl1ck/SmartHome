'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { api, type CalendarEventsResponse } from '@/lib/api';
import { formatEventWhen, isoDate, startOfLocalDay } from '@/lib/calendar-layout';
import { useStaleWhileRevalidate } from '@/hooks/useStaleWhileRevalidate';
import { friendlyError } from '@/lib/friendly-error';

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
  const fetchMonth = useCallback(
    () => api.getCalendarEvents(monthRange(year, month)),
    [year, month],
  );

  const { data, loading, error: loadError } = useStaleWhileRevalidate(
    `dash-calendar-${year}-${month}`,
    fetchMonth,
    15 * 60_000,
    initial,
  );

  const events = data?.events ?? [];
  const configured = data?.configured ?? false;
  const error = data?.error ?? loadError;

  if (loading && !data) {
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
          <p className="text-sm mt-0.5">Einstellungen → Widgets → iCal-URL</p>
        </div>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm text-destructive">{friendlyError('calendar', error)}</p>
      </div>
    );
  }

  const upcoming = [...events]
    .filter((ev) => new Date(ev.end ?? ev.start).getTime() >= today.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 3);

  return (
    <Link href="/calendar" className="block rounded-2xl border bg-card p-4 hover:bg-accent/40 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="h-5 w-5 text-violet-500 shrink-0" />
        <p className="font-semibold text-sm">Kalender</p>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine anstehenden Termine</p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((ev) => (
            <li key={ev.uid} className="min-w-0">
              <p className="text-sm font-medium truncate">{ev.title}</p>
              <p className="text-xs text-muted-foreground">{formatEventWhen(ev)}</p>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
