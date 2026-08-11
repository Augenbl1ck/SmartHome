'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type CalendarEvent, type CalendarEventsResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function eventTimeLabel(ev: CalendarEvent): string {
  if (ev.all_day) return 'Ganztägig';
  const start = formatTime(ev.start);
  if (!ev.end) return start;
  return `${start}–${formatTime(ev.end)}`;
}

/** Monday-based week index 0–6 */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function buildMonthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = mondayIndex(first);
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

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
    // Keep selection in new month if possible, else 1st
    const nextSelected = selected.getMonth() === d.getMonth() && selected.getFullYear() === d.getFullYear()
      ? selected
      : new Date(d.getFullYear(), d.getMonth(), Math.min(selected.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    setSelected(startOfLocalDay(nextSelected));
    void loadMonth(d.getFullYear(), d.getMonth());
  };

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const start = startOfLocalDay(new Date(ev.start));
      const end = ev.end ? startOfLocalDay(new Date(ev.end)) : start;
      for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
        const key = isoDate(cur);
        const list = map.get(key) ?? [];
        list.push(ev);
        map.set(key, list);
      }
    }
    return map;
  }, [events]);

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

      <div className={cn('rounded-2xl border bg-card p-3 sm:p-4', loading && 'opacity-60')}>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[11px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map(day => {
            const key = isoDate(day);
            const inMonth = day.getMonth() === month;
            const isToday = isSameDay(day, today);
            const isSelected = isSameDay(day, selected);
            const dayEvents = eventsByDay.get(key) ?? [];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(startOfLocalDay(day))}
                className={cn(
                  'relative flex flex-col items-center justify-start rounded-xl min-h-[3.25rem] sm:min-h-[4rem] p-1 transition-colors',
                  inMonth ? 'text-foreground' : 'text-muted-foreground/40',
                  isSelected && 'bg-primary text-primary-foreground',
                  !isSelected && isToday && 'ring-1 ring-primary/50',
                  !isSelected && 'hover:bg-accent/60',
                )}
              >
                <span className={cn('text-sm font-medium tabular-nums', isToday && !isSelected && 'text-primary')}>
                  {day.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <span className={cn(
                    'mt-auto mb-0.5 flex gap-0.5',
                    isSelected ? 'opacity-90' : '',
                  )}>
                    {dayEvents.slice(0, 3).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1 w-1 rounded-full',
                          isSelected ? 'bg-primary-foreground' : 'bg-violet-500',
                        )}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
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
                key={ev.uid + ev.start}
                className="flex items-start gap-3 rounded-xl px-2.5 py-2 bg-muted/40"
              >
                <span className="text-xs tabular-nums text-muted-foreground w-[4.5rem] shrink-0 pt-0.5">
                  {eventTimeLabel(ev)}
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
