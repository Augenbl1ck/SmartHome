'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Device, Room } from '@/lib/api';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
      {children}
    </label>
  );
}

export function TextInput({
  value, onChange, placeholder, type = 'text', inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
}) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

export function DeviceSelect({
  value, onChange, devices, rooms, placeholder = 'Gerät wählen…',
}: {
  value: string;
  onChange: (v: string) => void;
  devices: Device[];
  rooms: Room[];
  placeholder?: string;
}) {
  const unassigned = devices.filter((d) => !rooms.some((r) => r.id === d.room_id));
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {rooms.map((room) => {
          const roomDevices = devices.filter((d) => d.room_id === room.id);
          if (roomDevices.length === 0) return null;
          return (
            <SelectGroup key={room.id}>
              <SelectLabel>{room.icon} {room.name}</SelectLabel>
              {roomDevices.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
              ))}
            </SelectGroup>
          );
        })}
        {unassigned.length > 0 && (
          <SelectGroup>
            <SelectLabel>Ohne Raum</SelectLabel>
            {unassigned.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

const WEEKDAY_OPTS = [
  { label: 'Mo', value: 1 },
  { label: 'Di', value: 2 },
  { label: 'Mi', value: 3 },
  { label: 'Do', value: 4 },
  { label: 'Fr', value: 5 },
  { label: 'Sa', value: 6 },
  { label: 'So', value: 0 },
];

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (day: number) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {WEEKDAY_OPTS.map(({ label, value: day }) => (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            className={cn(
              'cursor-pointer min-h-11 px-3 py-2 text-sm rounded-md border font-medium transition-colors',
              value.includes(day)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-input text-muted-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2" onClick={() => onChange([1, 2, 3, 4, 5])}>Werktags</button>
        <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2" onClick={() => onChange([6, 0])}>Wochenende</button>
        <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2" onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>Täglich</button>
      </div>
    </div>
  );
}
