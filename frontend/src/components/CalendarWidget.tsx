'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { api, type CalendarEvent, type CalendarEventsResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import CalendarWeekBars from '@/components/CalendarWeekBars';
import {
  addDays,
  assignSlots,
  eventColor,
  eventDayRange,
  eventKey,
  expandOccurrences,
  isoDate,
  isSameDay,
  occurrenceTimeLabel,
  startOfLocalDay,
  startOfWeekMonday,
} from '@/lib/calendar-layout';

function formatDayLabel(d: Date): string {
  const today = startOfLocalDay();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(d, today)) return 'Heute';
  if (isSameDay(d, tomorrow)) return 'Morgen';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
const WIDGET_SLOTS = 2;
const LIST_CAP = 8;

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
      const today = startOfLocalDay();
      const from = startOfWeekMonday(today);
      const to = new Date(today);
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
    void load();
    const t = setInterval(load, 15 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  const now = new Date();
  const today = startOfLocalDay(now);
  const weekStart = startOfWeekMonday(today);
  const horizon = startOfLocalDay(today);
  horizon.setDate(horizon.getDate() + 13);

  const weekEvents = useMemo(() => {
    return events.filter((ev) => {
      const range = eventDayRange(ev);
      return range.end >= weekStart && range.start <= addDays(weekStart, 6);
    });
  }, [events, weekStart]);

  const slots = useMemo(() => assignSlots(weekEvents), [weekEvents]);

  const todayEvents = useMemo(() => {
    return events.filter((ev) => {
      const range = eventDayRange(ev);
      return range.start <= today && range.end >= today;
    });
  }, [events, today]);

  const nextUp = useMemo(
    () => expandOccurrences(events, today, horizon).slice(0, LIST_CAP),
    [events, today, horizon],
  );

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

      <Link href="/calendar" className="block mb-3 rounded-xl overflow-hidden border border-border/50 hover:opacity-90 transition-opacity">
        <div className="grid grid-cols-7 bg-muted/30">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">
              {d}
            </div>
          ))}
        </div>
        <CalendarWeekBars
          weekStart={weekStart}
          events={weekEvents}
          slots={slots}
          maxSlots={WIDGET_SLOTS}
          compact
          today={today}
        />
      </Link>

      {nextUp.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Termine in den nächsten 14 Tagen</p>
      ) : (
        <ul className="space-y-2">
          {nextUp.map(({ day, ev }) => {
            const dayKey = isoDate(day);
            const showDay = dayKey !== lastDayKey;
            lastDayKey = dayKey;
            return (
              <li key={`${eventKey(ev)}-${dayKey}`}>
                {showDay && (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1 mt-1 first:mt-0">
                    {formatDayLabel(day)}
                  </p>
                )}
                <div className={cn(
                  'flex items-start gap-3 rounded-xl px-2.5 py-2',
                  isSameDay(day, today) && 'bg-violet-500/8',
                )}>
                  <span className={cn('mt-1 h-8 w-1 shrink-0 rounded-full', eventColor(ev).stripe)} />
                  <span className="text-xs tabular-nums text-muted-foreground w-[4.5rem] shrink-0 pt-0.5">
                    {occurrenceTimeLabel(ev, day)}
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
