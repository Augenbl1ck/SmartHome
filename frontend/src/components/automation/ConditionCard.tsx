'use client';

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Device, Room } from '@/lib/api';
import {
  ConditionFormItem, ConditionLogic, DeviceStatus,
} from '@/lib/automation-form';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DeviceSelect, FieldLabel, TextInput, WeekdayPicker } from '@/components/automation/fields';
import { iconFor, labelFor } from '@/components/automation/BlockPicker';
import { todayIso } from '@/lib/automation-form';

export default function ConditionCard({
  cond, index, logic, canRemove, canMoveUp, canMoveDown,
  devices, rooms, onChange, onRemove, onMove,
}: {
  cond: ConditionFormItem;
  index: number;
  logic: ConditionLogic;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  devices: Device[];
  rooms: Room[];
  onChange: (patch: Partial<ConditionFormItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const switchable = devices.filter((d) => ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan', 'cover', 'valve', 'other', 'computer'].includes(d.type));
  const tempSensors = devices.filter((d) => d.type === 'sensor_temperature' || d.type === 'thermostat');
  const humiditySensors = devices.filter((d) => d.type === 'sensor_humidity' || d.attributes?.humidity != null);
  const motionSensors = devices.filter((d) => d.type === 'sensor_motion');
  const doorSensors = devices.filter((d) => d.type === 'sensor_door');
  const thermostats = devices.filter((d) => d.type === 'thermostat');
  const powerDevices = devices.filter((d) => d.type === 'plug' || d.type === 'switch' || d.type === 'energy_meter' || d.attributes?.power_w != null);

  const needsTemp = cond.type === 'temperature_above' || cond.type === 'temperature_below';
  const needsHum = cond.type === 'humidity_above' || cond.type === 'humidity_below';
  const needsPower = cond.type === 'power_above' || cond.type === 'power_below';
  const needsDoor = cond.type === 'door_open' || cond.type === 'door_closed';
  const list = needsTemp ? tempSensors : needsHum ? humiditySensors : needsPower ? powerDevices : needsDoor ? doorSensors : cond.type === 'motion' ? motionSensors : thermostats;
  const Icon = iconFor('condition', cond.type);

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{labelFor('condition', cond.type)}</p>
          {index > 0 && (
            <p className="text-xs text-muted-foreground">{logic === 'or' ? 'oder' : 'und'}</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label="Nach oben">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label="Nach unten">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" disabled={!canRemove} onClick={onRemove} aria-label="Entfernen">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {cond.type === 'device_status' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Gerät</FieldLabel>
            <DeviceSelect value={cond.deviceId} onChange={(v) => onChange({ deviceId: v })} devices={switchable} rooms={rooms} />
          </div>
          <div className="space-y-1">
            <FieldLabel>Status</FieldLabel>
            <Select value={cond.status} onValueChange={(v) => onChange({ status: v as DeviceStatus })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on">an</SelectItem>
                <SelectItem value="off">aus</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {(needsTemp || needsHum || needsPower) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Gerät</FieldLabel>
            {list.length > 0
              ? <DeviceSelect value={cond.deviceId} onChange={(v) => onChange({ deviceId: v })} devices={list} rooms={rooms} />
              : <p className="text-xs text-muted-foreground py-2">Keine passenden Geräte.</p>}
          </div>
          <div className="space-y-1">
            <FieldLabel>{needsPower ? 'Watt' : 'Schwellwert'}</FieldLabel>
            <TextInput type="number" value={cond.threshold} onChange={(v) => onChange({ threshold: v })} />
          </div>
        </div>
      )}

      {(needsDoor || cond.type === 'motion') && (
        <div className="space-y-1">
          <FieldLabel>Gerät</FieldLabel>
          {list.length > 0
            ? <DeviceSelect value={cond.deviceId} onChange={(v) => onChange({ deviceId: v })} devices={list} rooms={rooms} />
            : <p className="text-xs text-muted-foreground py-2">Keine passenden Sensoren.</p>}
        </div>
      )}

      {cond.type === 'time_at' && (
        <div className="space-y-1 max-w-xs">
          <FieldLabel>Uhrzeit</FieldLabel>
          <TextInput value={cond.time} onChange={(v) => onChange({ time: v })} placeholder="08:00" inputMode="decimal" />
        </div>
      )}

      {(cond.type === 'sunrise' || cond.type === 'sunset') && (
        <div className="space-y-1 max-w-xs">
          <FieldLabel>Offset (Minuten)</FieldLabel>
          <TextInput type="number" value={cond.offsetMinutes} onChange={(v) => onChange({ offsetMinutes: v })} />
          <p className="text-xs text-muted-foreground">Negativ = früher, positiv = später (−120…+120).</p>
        </div>
      )}

      {cond.type === 'time_between' && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-input"
              checked={cond.useDates}
              onChange={(e) => {
                const on = e.target.checked;
                onChange({
                  useDates: on,
                  fromDate: on && !cond.fromDate ? todayIso() : cond.fromDate,
                  toDate: on && !cond.toDate ? todayIso() : cond.toDate,
                });
              }}
            />
            Datum angeben
          </label>
          {cond.useDates && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel>Von Datum</FieldLabel>
                <TextInput value={cond.fromDate} onChange={(v) => onChange({ fromDate: v })} placeholder="2026-09-19" />
              </div>
              <div className="space-y-1">
                <FieldLabel>Bis Datum</FieldLabel>
                <TextInput value={cond.toDate} onChange={(v) => onChange({ toDate: v })} placeholder="2026-09-19" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>Von</FieldLabel>
              <TextInput value={cond.from} onChange={(v) => onChange({ from: v })} placeholder="08:00" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <FieldLabel>Bis</FieldLabel>
              <TextInput value={cond.to} onChange={(v) => onChange({ to: v })} placeholder="22:00" inputMode="decimal" />
            </div>
          </div>
        </div>
      )}

      {cond.type === 'weekday' && (
        <WeekdayPicker value={cond.weekdays} onChange={(v) => onChange({ weekdays: v })} />
      )}

      {(cond.type === 'child_lock' || cond.type === 'open_window') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Thermostat</FieldLabel>
            {thermostats.length > 0
              ? <DeviceSelect value={cond.deviceId} onChange={(v) => onChange({ deviceId: v })} devices={thermostats} rooms={rooms} />
              : <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>}
          </div>
          <div className="space-y-1">
            <FieldLabel>Wert</FieldLabel>
            {cond.type === 'child_lock' ? (
              <Select value={cond.value} onValueChange={(v) => onChange({ value: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOCK">an</SelectItem>
                  <SelectItem value="UNLOCK">aus</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Select value={cond.value} onValueChange={(v) => onChange({ value: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ON">an</SelectItem>
                  <SelectItem value="OFF">aus</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
