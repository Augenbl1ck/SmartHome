import type { CalendarEvent } from '@/lib/api';

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Local YYYY-MM-DD — toISOString() shifts the day in CET/CEST. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-based week index 0–6 */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function startOfWeekMonday(d: Date): Date {
  const start = startOfLocalDay(d);
  start.setDate(start.getDate() - mondayIndex(start));
  return start;
}

export function addDays(d: Date, n: number): Date {
  const next = startOfLocalDay(d);
  next.setDate(next.getDate() + n);
  return next;
}

export function diffDays(a: Date, b: Date): number {
  const a0 = startOfLocalDay(a).getTime();
  const b0 = startOfLocalDay(b).getTime();
  return Math.round((b0 - a0) / 86_400_000);
}

export function eventKey(ev: CalendarEvent): string {
  return `${ev.uid}::${ev.start}`;
}

export function eventDayRange(ev: CalendarEvent): { start: Date; end: Date } {
  const start = startOfLocalDay(new Date(ev.start));
  const end = ev.end ? startOfLocalDay(new Date(ev.end)) : start;
  return end < start ? { start, end: start } : { start, end };
}

export function eachLocalDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const last = startOfLocalDay(end);
  for (let cur = startOfLocalDay(start); cur <= last; cur.setDate(cur.getDate() + 1)) {
    days.push(new Date(cur));
  }
  return days;
}

const EVENT_COLORS = [
  { bar: 'bg-teal-600', stripe: 'bg-teal-600' },
  { bar: 'bg-violet-600', stripe: 'bg-violet-600' },
  { bar: 'bg-blue-600', stripe: 'bg-blue-600' },
  { bar: 'bg-amber-500', stripe: 'bg-amber-500' },
  { bar: 'bg-rose-400', stripe: 'bg-rose-400' },
  { bar: 'bg-indigo-600', stripe: 'bg-indigo-600' },
] as const;

export type EventColor = (typeof EVENT_COLORS)[number];

export function eventColor(ev: CalendarEvent): EventColor {
  const s = ev.uid || ev.title;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return EVENT_COLORS[h % EVENT_COLORS.length];
}

export function assignSlots(events: CalendarEvent[]): Map<string, number> {
  const ranked = [...events].sort((a, b) => {
    const ra = eventDayRange(a);
    const rb = eventDayRange(b);
    const durB = diffDays(rb.start, rb.end);
    const durA = diffDays(ra.start, ra.end);
    if (durB !== durA) return durB - durA;
    if (ra.start.getTime() !== rb.start.getTime()) return ra.start.getTime() - rb.start.getTime();
    return a.title.localeCompare(b.title, 'de');
  });

  const occupancy: Array<Set<string>> = [];
  const slots = new Map<string, number>();

  for (const ev of ranked) {
    const days = eachLocalDay(eventDayRange(ev).start, eventDayRange(ev).end).map(isoDate);
    let slot = 0;
    while (true) {
      if (!occupancy[slot]) occupancy[slot] = new Set();
      const taken = days.some((d) => occupancy[slot].has(d));
      if (!taken) {
        for (const d of days) occupancy[slot].add(d);
        slots.set(eventKey(ev), slot);
        break;
      }
      slot += 1;
    }
  }

  return slots;
}

export interface BarSegment {
  key: string;
  event: CalendarEvent;
  slot: number;
  colStart: number;
  span: number;
  isStart: boolean;
  isEnd: boolean;
}

export function weekSegments(
  events: CalendarEvent[],
  weekStart: Date,
  slots: Map<string, number>,
  maxSlots: number,
): { bars: BarSegment[]; overflowByDay: number[] } {
  const monday = startOfLocalDay(weekStart);
  const weekEnd = addDays(monday, 6);
  const bars: BarSegment[] = [];
  const overflowByDay = [0, 0, 0, 0, 0, 0, 0];

  for (const ev of events) {
    const range = eventDayRange(ev);
    if (range.end < monday || range.start > weekEnd) continue;

    const clipStart = range.start < monday ? monday : range.start;
    const clipEnd = range.end > weekEnd ? weekEnd : range.end;
    const colStart = diffDays(monday, clipStart);
    const span = diffDays(clipStart, clipEnd) + 1;
    const slot = slots.get(eventKey(ev)) ?? 0;

    if (slot >= maxSlots) {
      for (let i = 0; i < span; i++) overflowByDay[colStart + i] += 1;
      continue;
    }

    bars.push({
      key: `${eventKey(ev)}::${isoDate(clipStart)}`,
      event: ev,
      slot,
      colStart,
      span,
      isStart: isSameDay(clipStart, range.start),
      isEnd: isSameDay(clipEnd, range.end),
    });
  }

  return { bars, overflowByDay };
}

export function expandOccurrences(
  events: CalendarEvent[],
  from: Date,
  to: Date,
): { day: Date; ev: CalendarEvent }[] {
  const fromDay = startOfLocalDay(from);
  const toDay = startOfLocalDay(to);
  const out: { day: Date; ev: CalendarEvent }[] = [];

  for (const ev of events) {
    const range = eventDayRange(ev);
    for (const day of eachLocalDay(range.start, range.end)) {
      if (day < fromDay || day > toDay) continue;
      out.push({ day, ev });
    }
  }

  out.sort((a, b) => {
    const dayDiff = a.day.getTime() - b.day.getTime();
    if (dayDiff !== 0) return dayDiff;
    if (a.ev.all_day !== b.ev.all_day) return a.ev.all_day ? -1 : 1;
    return a.ev.start.localeCompare(b.ev.start) || a.ev.title.localeCompare(b.ev.title, 'de');
  });

  return out;
}

export function eventsByDayMap(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const range = eventDayRange(ev);
    for (const day of eachLocalDay(range.start, range.end)) {
      const key = isoDate(day);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
  }
  return map;
}

export function buildMonthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = addDays(first, -mondayIndex(first));
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  return cells;
}

export function formatEventTime(ev: CalendarEvent): string {
  if (ev.all_day) return 'Ganztägig';
  const start = new Date(ev.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (!ev.end) return start;
  const end = new Date(ev.end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${start}–${end}`;
}

function formatDayShort(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
}

/** Uhrzeit, bei Mehrtages-Terminen inkl. Von–Bis-Datum. */
export function formatEventWhen(ev: CalendarEvent): string {
  const range = eventDayRange(ev);
  const multi = !isSameDay(range.start, range.end);
  if (!multi) return formatEventTime(ev);

  const from = formatDayShort(range.start);
  const to = formatDayShort(range.end);
  if (ev.all_day) return `${from} – ${to}`;

  const startT = new Date(ev.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (!ev.end) return `${from} ${startT} – ${to}`;
  const endT = new Date(ev.end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${from} ${startT} – ${to} ${endT}`;
}

export function occurrenceTimeLabel(ev: CalendarEvent, day: Date): string {
  const range = eventDayRange(ev);
  const multi = !isSameDay(range.start, range.end);
  if (!multi) return formatEventTime(ev);

  const endWeekday = range.end.toLocaleDateString('de-DE', { weekday: 'short' });
  if (ev.all_day) {
    if (isSameDay(day, range.end)) return 'Letzter Tag';
    return `bis ${endWeekday}`;
  }
  if (isSameDay(day, range.start)) {
    const start = new Date(ev.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${start}–`;
  }
  if (isSameDay(day, range.end) && ev.end) {
    const end = new Date(ev.end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `–${end}`;
  }
  return `bis ${endWeekday}`;
}
