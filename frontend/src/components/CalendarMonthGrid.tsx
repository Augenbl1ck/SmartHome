'use client';

import type { CalendarEvent } from '@/lib/api';
import { cn } from '@/lib/utils';
import CalendarWeekBars from '@/components/CalendarWeekBars';
import {
  assignSlots,
  buildMonthCells,
  isoDate,
} from '@/lib/calendar-layout';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export const MONTH_SLOTS = 3;

interface Props {
  year: number;
  month: number;
  events: CalendarEvent[];
  today: Date;
  selected?: Date | null;
  onSelectDay?: (day: Date) => void;
  compact?: boolean;
  maxSlots?: number;
  className?: string;
}

export default function CalendarMonthGrid({
  year,
  month,
  events,
  today,
  selected = null,
  onSelectDay,
  compact = false,
  maxSlots = MONTH_SLOTS,
  className,
}: Props) {
  const cells = buildMonthCells(year, month);
  const weeks: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const slots = assignSlots(events);

  return (
    <div className={cn('overflow-hidden', className)}>
      <div className="grid grid-cols-7 mb-0.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className={cn(
              'text-center font-medium text-muted-foreground py-1',
              compact ? 'text-[10px]' : 'text-[11px]',
            )}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="border-b border-border/50">
        {weeks.map((week) => (
          <CalendarWeekBars
            key={isoDate(week[0])}
            weekStart={week[0]}
            events={events}
            slots={slots}
            maxSlots={maxSlots}
            compact={compact}
            selected={selected}
            today={today}
            month={month}
            onSelectDay={onSelectDay}
          />
        ))}
      </div>
    </div>
  );
}
