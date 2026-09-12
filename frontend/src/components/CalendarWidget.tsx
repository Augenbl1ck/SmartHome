'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { api, type CalendarEventsResponse } from '@/lib/api';
import CalendarMonthGrid from '@/components/CalendarMonthGrid';
import { isoDate, startOfLocalDay } from '@/lib/calendar-layout';
import { useStaleWhileRevalidate } from '@/hooks/useStaleWhileRevalidate';
import { useKiosk } from '@/components/KioskProvider';

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
  const { kioskMode } = useKiosk();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = startOfLocalDay(now);
  const monthTitle = new Date(year, month, 1).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });

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
          <p className="text-xs mt-0.5">Einstellungen → Widgets → iCal-URL</p>
        </div>
      </div>
    );
  }

  if (error && events.length === 0) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className={kioskMode ? 'rounded-2xl border bg-card p-1.5' : 'rounded-2xl border bg-card p-2.5 sm:p-3'}>
      <Link href="/calendar" className="flex items-center gap-1.5 min-w-0 mb-1.5 hover:opacity-80 transition-opacity">
        <CalendarDays className="h-4 w-4 text-violet-500 shrink-0" />
        <p className="font-semibold text-xs">Kalender</p>
        <span className="text-[11px] text-muted-foreground capitalize truncate">{monthTitle}</span>
      </Link>
      <Link href="/calendar" className="block hover:opacity-95 transition-opacity">
        <CalendarMonthGrid
          year={year}
          month={month}
          events={events}
          today={today}
          compact={kioskMode}
          scale={0.85}
        />
      </Link>
    </div>
  );
}
