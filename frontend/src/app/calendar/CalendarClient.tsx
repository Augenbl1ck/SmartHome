'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type CalendarEvent, type CalendarEventsResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import CalendarMonthGrid from '@/components/CalendarMonthGrid';
import {
  eventColor,
  eventKey,
  eventsByDayMap,
  formatEventWhen,
  isoDate,
  startOfLocalDay,
} from '@/lib/calendar-layout';

interface Props {
  initialYear: number;
  initialMonth: number;
  initial: CalendarEventsResponse;
}

export default function CalendarClient({ initialYear, initialMonth, initial }: Props) {
  const router = useRouter();
  const today = startOfLocalDay(new Date());
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [selected, setSelected] = useState<Date>(today);
  const [events, setEvents] = useState<CalendarEvent[]>(initial.events ?? []);
  const [configured, setConfigured] = useState(initial.configured);
  const [error, setError] = useState<string | null>(initial.error ?? null);
  const [loading, setLoading] = useState(false);

  const loadMonth = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date(y, m, 1);
      from.setDate(from.getDate() - 7);
      const to = new Date(y, m + 1, 0);
      to.setDate(to.getDate() + 7);
      const res = await api.getCalendarEvents({ from: isoDate(from), to: isoDate(to) });
      setConfigured(res.configured);
      setError(res.error ?? null);
      setEvents(res.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kalender nicht ladbar');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const goMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    const nextSelected = selected.getMonth() === d.getMonth() && selected.getFullYear() === d.getFullYear()
      ? selected
      : new Date(d.getFullYear(), d.getMonth(), Math.min(selected.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    setSelected(startOfLocalDay(nextSelected));
    void loadMonth(d.getFullYear(), d.getMonth());
  };

  const eventsByDay = useMemo(() => eventsByDayMap(events), [events]);
  const selectedEvents = eventsByDay.get(isoDate(selected)) ?? [];
  const monthTitle = new Date(year, month, 1).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
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
          <h1 className="text-2xl font-bold leading-tight truncate">Kalender</h1>
          <p className="text-sm text-muted-foreground capitalize truncate">{monthTitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => goMonth(-1)} aria-label="Vorheriger Monat">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <p className="flex-1 text-center text-base font-semibold capitalize">{monthTitle}</p>
        <Button variant="outline" size="icon" onClick={() => goMonth(1)} aria-label="Nächster Monat">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {!configured && (
        <p className="text-sm text-muted-foreground text-center rounded-xl border bg-card px-4 py-3">
          Kalender noch nicht eingerichtet — Einstellungen → Widgets
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive text-center rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          {error}
        </p>
      )}

      <div className={cn('rounded-2xl border bg-card p-2 sm:p-3 overflow-hidden', loading && 'opacity-60')}>
        <CalendarMonthGrid
          year={year}
          month={month}
          events={events}
          today={today}
          selected={selected}
          onSelectDay={setSelected}
        />
      </div>

      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold mb-3">
          {selected.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        {selectedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Termine</p>
        ) : (
          <ul className="space-y-2">
            {selectedEvents.map(ev => (
              <li
                key={eventKey(ev)}
                className="flex items-start gap-3 rounded-xl px-2.5 py-2 bg-muted/40"
              >
                <span className={cn('mt-1 h-8 w-1 shrink-0 rounded-full', eventColor(ev).stripe)} />
                <span className="text-xs tabular-nums text-muted-foreground min-w-[5.5rem] max-w-[8.5rem] shrink-0 pt-0.5 leading-snug">
                  {formatEventWhen(ev)}
                </span>
                <span className="text-sm font-medium leading-snug min-w-0 break-words">
                  {ev.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
