'use client';

import type { CalendarEvent } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  addDays,
  eventColor,
  isoDate,
  isSameDay,
  startOfLocalDay,
  weekSegments,
} from '@/lib/calendar-layout';

interface Props {
  weekStart: Date;
  events: CalendarEvent[];
  slots: Map<string, number>;
  maxSlots: number;
  compact?: boolean;
  selected?: Date | null;
  today: Date;
  month?: number;
  onSelectDay?: (day: Date) => void;
}

export default function CalendarWeekBars({
  weekStart,
  events,
  slots,
  maxSlots,
  compact = false,
  selected = null,
  today,
  month,
  onSelectDay,
}: Props) {
  const monday = startOfLocalDay(weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const { bars, overflowByDay } = weekSegments(events, monday, slots, maxSlots);

  const headerH = compact ? 26 : 28;
  const slotH = compact ? 16 : 20;
  const overflowH = compact ? 14 : 16;
  const rowMinH = headerH + maxSlots * slotH + overflowH;

  return (
    <div className="relative border-t border-border/50">
      <div className="grid grid-cols-7" style={{ minHeight: rowMinH }}>
        {days.map((day, i) => {
          const inMonth = month === undefined || day.getMonth() === month;
          const isToday = isSameDay(day, today);
          const isSelected = selected ? isSameDay(day, selected) : false;
          const overflow = overflowByDay[i];
          const inner = (
            <>
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums sm:h-7 sm:w-7 sm:text-sm',
                  isSelected && 'bg-primary text-primary-foreground',
                  isToday && !isSelected && 'ring-1 ring-primary text-primary',
                  !inMonth && !isSelected && 'text-muted-foreground/40',
                )}
              >
                {day.getDate()}
              </span>
              <span className={cn(
                'mt-auto text-[10px] leading-none text-muted-foreground tabular-nums h-3',
                compact && 'text-[9px]',
              )}>
                {overflow > 0 ? `+${overflow}` : ''}
              </span>
            </>
          );
          const className = cn(
            'relative flex flex-col items-end gap-0.5 px-0.5 pt-0.5 pb-0.5 border-r border-border/40 last:border-r-0',
            onSelectDay && 'hover:bg-muted/40 transition-colors cursor-pointer',
          );
          if (onSelectDay) {
            return (
              <button
                key={isoDate(day)}
                type="button"
                onClick={() => onSelectDay(startOfLocalDay(day))}
                className={className}
                style={{ minHeight: rowMinH }}
              >
                {inner}
              </button>
            );
          }
          return (
            <div key={isoDate(day)} className={className} style={{ minHeight: rowMinH }}>
              {inner}
            </div>
          );
        })}
      </div>

      <div
        className="absolute left-0 right-0 pointer-events-none overflow-hidden"
        style={{ top: headerH, height: maxSlots * slotH }}
      >
        {bars.map((seg) => {
          const color = eventColor(seg.event);
          const insetL = seg.isStart ? 3 : 0;
          const insetR = seg.isEnd ? 3 : 0;
          const showTitle = !compact || seg.span >= 2;
          return (
            <div
              key={seg.key}
              className={cn(
                'absolute overflow-hidden text-white font-semibold leading-4 px-1',
                compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]',
                seg.isStart && 'rounded-l-[4px]',
                seg.isEnd && 'rounded-r-[4px]',
                color.bar,
              )}
              style={{
                left: `calc(${(seg.colStart / 7) * 100}% + ${insetL}px)`,
                width: `calc(${(seg.span / 7) * 100}% - ${insetL + insetR}px)`,
                top: seg.slot * slotH + 1,
                height: slotH - 3,
              }}
              title={seg.event.title}
            >
              {showTitle && (
                <span className="block truncate">{seg.event.title}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
