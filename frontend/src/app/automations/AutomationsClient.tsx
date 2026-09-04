'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { api, Automation, AutomationLog, Device, Room, Scene } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Pencil, Plus, Trash2, Clock, Zap, ChevronRight, ArrowLeft,
  Thermometer, Droplets, Activity, DoorOpen, Timer, History,
  Waves, Flame, Battery, Gauge, Filter, Clapperboard, Shield,
  List, LayoutGrid,
} from 'lucide-react';
import { getEcho } from '@/lib/echo';
import { isInterlockAutomation } from '@/lib/devices';
import { useSmartHomeStore } from '@/store/smarthome';

// ── Aktions-Typen ─────────────────────────────────────────────────────────────

type ActionType =
  | 'set_device_status'
  | 'toggle_device'
  | 'set_room_devices'
  | 'delayed_off'
  | 'delayed_on'
  | 'set_thermostat_setpoint'
  | 'set_thermostat_mode'
  | 'set_thermostat_child_lock'
  | 'set_thermostat_open_window'
  | 'set_thermostat_calibration'
  | 'set_thermostat_frost_protection'
  | 'activate_scene'
  | 'notify';

type DeviceStatus = 'on' | 'off';
type ActionDeviceStatus = 'on' | 'off' | 'open' | 'close' | 'stop';
type ThermostatMode = 'heat' | 'off' | 'auto';
type ConditionLogic = 'and' | 'or';
type ConditionType =
  | 'device_status'
  | 'temperature_above'
  | 'temperature_below'
  | 'humidity_above'
  | 'humidity_below'
  | 'door_open'
  | 'door_closed'
  | 'motion'
  | 'time_between'
  | 'time_at'
  | 'sunrise'
  | 'sunset'
  | 'weekday'
  | 'child_lock'
  | 'open_window';

const SWITCHABLE_TYPES = ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan', 'cover', 'valve', 'other', 'computer'];

interface ConditionFormItem {
  id: string;
  type: ConditionType;
  deviceId: string;
  status: DeviceStatus;
  threshold: string;
  from: string;
  to: string;
  time: string;
  weekdays: number[];
  value: string;
  useDates: boolean;
  fromDate: string;
  toDate: string;
  offsetMinutes: string;
}

interface ActionFormItem {
  id: string;
  type: ActionType;
  deviceId: string;
  deviceStatus: ActionDeviceStatus;
  roomId: string;
  roomStatus: DeviceStatus;
  delayMinutes: string;
  notifyMessage: string;
  setpoint: string;
  thermostatMode: ThermostatMode;
  sceneId: string;
  childLock: boolean;
  openWindow: boolean;
  calibration: string;
  frostProtection: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const newCondition = (): ConditionFormItem => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type: 'device_status',
  deviceId: '',
  status: 'on',
  threshold: '22',
  from: '22:00',
  to: '06:00',
  time: '08:00',
  weekdays: [1, 2, 3, 4, 5],
  value: 'LOCK',
  useDates: false,
  fromDate: '',
  toDate: '',
  offsetMinutes: '0',
});

const newAction = (): ActionFormItem => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type: 'set_device_status',
  deviceId: '',
  deviceStatus: 'on',
  roomId: '',
  roomStatus: 'off',
  delayMinutes: '10',
  notifyMessage: '',
  setpoint: '21',
  thermostatMode: 'heat',
  sceneId: '',
  childLock: true,
  openWindow: true,
  calibration: '0',
  frostProtection: '5',
});

// ── Form-State ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  kind: 'automation' | 'lock';
  conditionLogic: ConditionLogic;
  conditions: ConditionFormItem[];
  actions: ActionFormItem[];
  blockDeviceId: string;
  blockStatus: ActionDeviceStatus | 'heat';
}

const emptyForm = (): FormState => ({
  name: '',
  kind: 'automation',
  conditionLogic: 'and',
  conditions: [newCondition()],
  actions: [newAction()],
  blockDeviceId: '',
  blockStatus: 'off',
});

function conditionFromJson(item: Record<string, unknown>): ConditionFormItem {
  const type = (item.type as ConditionType) ?? 'device_status';
  let value = item.value != null ? String(item.value) : 'LOCK';
  if (type === 'open_window' && item.value == null) value = 'ON';
  if (type === 'child_lock' && item.value == null) value = 'LOCK';
  const fromDate = item.from_date != null ? String(item.from_date) : '';
  const toDate = item.to_date != null ? String(item.to_date) : '';
  const useDates = !!(fromDate && toDate);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    deviceId: item.device_id != null ? String(item.device_id) : '',
    status: (item.status as DeviceStatus) ?? 'on',
    threshold: item.threshold != null ? String(item.threshold) : '22',
    from: (item.from as string) ?? '22:00',
    to: (item.to as string) ?? '06:00',
    time: (item.time as string) ?? '08:00',
    weekdays: (item.weekdays as number[]) ?? [1, 2, 3, 4, 5],
    value,
    useDates,
    fromDate,
    toDate,
    offsetMinutes: item.offset_minutes != null ? String(item.offset_minutes) : '0',
  };
}

function actionFromJson(ac: Record<string, unknown>): ActionFormItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: (ac.type as ActionType) ?? 'set_device_status',
    deviceId: ac.device_id != null ? String(ac.device_id) : '',
    deviceStatus: (ac.status as ActionDeviceStatus) ?? 'on',
    roomId: ac.room_id != null ? String(ac.room_id) : '',
    roomStatus: (ac.status as DeviceStatus) ?? 'off',
    delayMinutes: ac.minutes != null ? String(ac.minutes) : '10',
    notifyMessage: (ac.message as string) ?? '',
    setpoint: ac.setpoint != null ? String(ac.setpoint) : '21',
    thermostatMode: (ac.mode as ThermostatMode) ?? 'heat',
    sceneId: ac.scene_id != null ? String(ac.scene_id) : '',
    childLock: ac.locked != null ? Boolean(ac.locked) : true,
    openWindow: ac.enabled != null ? Boolean(ac.enabled) : true,
    calibration: ac.type === 'set_thermostat_calibration' && ac.value != null
      ? String(ac.value)
      : '0',
    frostProtection: ac.type === 'set_thermostat_frost_protection' && ac.value != null
      ? String(ac.value)
      : '5',
  };
}

/** Map classic triggers to conditions when automation has no conditions yet. */
function conditionsFromLegacyTrigger(t: Record<string, unknown>): ConditionFormItem[] {
  const base = newCondition();
  const deviceId = t.device_id != null ? String(t.device_id) : '';
  switch (t.type) {
    case 'time':
      return [{ ...base, type: 'time_at', time: (t.time as string) ?? '08:00' }];
    case 'weekday_time':
      return [
        { ...newCondition(), type: 'time_at', time: (t.time as string) ?? '08:00' },
        {
          ...newCondition(),
          type: 'weekday',
          weekdays: (t.weekdays as number[]) ?? [1, 2, 3, 4, 5],
        },
      ];
    case 'device_status':
      return [{
        ...base,
        type: 'device_status',
        deviceId,
        status: (t.status as DeviceStatus) ?? 'on',
      }];
    case 'temperature_above':
    case 'temperature_below':
    case 'humidity_above':
    case 'humidity_below':
      return [{
        ...base,
        type: t.type as ConditionType,
        deviceId,
        threshold: t.threshold != null ? String(t.threshold) : '25',
      }];
    case 'motion':
    case 'door_open':
    case 'door_closed':
      return [{ ...base, type: t.type as ConditionType, deviceId }];
    case 'device_on_duration':
      return [{ ...base, type: 'device_status', deviceId, status: 'on' }];
    case 'flood':
    case 'smoke':
    case 'battery_low':
    case 'power_above':
      return [newCondition()];
    default:
      return [newCondition()];
  }
}

function automationToForm(a: Automation): FormState {
  const t = a.trigger as Record<string, unknown>;
  const ac = a.action as Record<string, unknown>;
  const cond = a.conditions;
  const existingItems = cond?.items ?? [];
  const mappedConditions =
    existingItems.length > 0
      ? existingItems.map((item) => conditionFromJson(item as Record<string, unknown>))
      : t.type && t.type !== 'conditions'
        ? conditionsFromLegacyTrigger(t)
        : [newCondition()];

  const mappedActions =
    ac.type === 'multi' && Array.isArray(ac.actions)
      ? (ac.actions as Record<string, unknown>[]).map(actionFromJson)
      : [actionFromJson(ac)];

  return {
    name: a.name,
    kind: t.type === 'interlock' ? 'lock' : 'automation',
    conditionLogic: (cond?.logic as ConditionLogic) ?? 'and',
    conditions: mappedConditions,
    actions: mappedActions.length > 0 ? mappedActions : [newAction()],
    blockDeviceId: ac.device_id != null ? String(ac.device_id) : '',
    blockStatus: (ac.status as FormState['blockStatus']) ?? 'off',
  };
}

// ── Aktion / Bedingungen → JSON ───────────────────────────────────────────────

function buildActionItem(a: ActionFormItem): Record<string, unknown> {
  switch (a.type) {
    case 'set_device_status':
      return { type: 'set_device_status', device_id: Number(a.deviceId), status: a.deviceStatus };
    case 'toggle_device':
      return { type: 'toggle_device', device_id: Number(a.deviceId) };
    case 'set_room_devices':
      return { type: 'set_room_devices', room_id: Number(a.roomId), status: a.roomStatus };
    case 'delayed_off':
      return { type: 'delayed_off', device_id: Number(a.deviceId), minutes: Number(a.delayMinutes) };
    case 'delayed_on':
      return { type: 'delayed_on', device_id: Number(a.deviceId), minutes: Number(a.delayMinutes) };
    case 'set_thermostat_setpoint':
      return { type: 'set_thermostat_setpoint', device_id: Number(a.deviceId), setpoint: Number(a.setpoint) };
    case 'set_thermostat_mode':
      return { type: 'set_thermostat_mode', device_id: Number(a.deviceId), mode: a.thermostatMode };
    case 'set_thermostat_child_lock':
      return { type: 'set_thermostat_child_lock', device_id: Number(a.deviceId), locked: a.childLock };
    case 'set_thermostat_open_window':
      return { type: 'set_thermostat_open_window', device_id: Number(a.deviceId), enabled: a.openWindow };
    case 'set_thermostat_calibration':
      return { type: 'set_thermostat_calibration', device_id: Number(a.deviceId), value: Number(a.calibration) };
    case 'set_thermostat_frost_protection':
      return { type: 'set_thermostat_frost_protection', device_id: Number(a.deviceId), value: Number(a.frostProtection) };
    case 'activate_scene':
      return { type: 'activate_scene', scene_id: Number(a.sceneId) };
    case 'notify':
      return { type: 'notify', message: a.notifyMessage };
  }
}

function buildAction(f: FormState): Record<string, unknown> {
  if (f.actions.length === 1) return buildActionItem(f.actions[0]);
  return { type: 'multi', actions: f.actions.map(buildActionItem) };
}

function buildConditions(f: FormState): { logic: ConditionLogic; items: Record<string, unknown>[] } {
  const items = f.conditions.map((c) => {
    switch (c.type) {
      case 'device_status':
        return { type: 'device_status', device_id: Number(c.deviceId), status: c.status };
      case 'temperature_above':
      case 'temperature_below':
      case 'humidity_above':
      case 'humidity_below':
        return { type: c.type, device_id: Number(c.deviceId), threshold: Number(c.threshold) };
      case 'door_open':
      case 'door_closed':
      case 'motion':
        return { type: c.type, device_id: Number(c.deviceId) };
      case 'time_between': {
        const base: Record<string, unknown> = { type: 'time_between', from: c.from, to: c.to };
        if (c.useDates && c.fromDate && c.toDate) {
          base.from_date = c.fromDate;
          base.to_date = c.toDate;
        }
        return base;
      }
      case 'time_at':
        return { type: 'time_at', time: c.time };
      case 'sunrise':
      case 'sunset':
        return { type: c.type, offset_minutes: Number(c.offsetMinutes) || 0 };
      case 'weekday':
        return { type: 'weekday', weekdays: c.weekdays };
      case 'child_lock':
      case 'open_window':
        return { type: c.type, device_id: Number(c.deviceId), value: c.value };
    }
  });
  return { logic: f.conditionLogic, items };
}

// ── Menschenlesbare Texte ─────────────────────────────────────────────────────

const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatDeDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function statusActionLabel(status: unknown): string {
  switch (status) {
    case 'on': return 'einschalten';
    case 'off': return 'ausschalten';
    case 'heat': return 'heizen';
    case 'open': return 'oeffnen';
    case 'close': return 'schliessen';
    case 'stop': return 'stopp';
    default: return String(status ?? '');
  }
}

function describeConditionItem(item: Record<string, unknown>, devices: Device[]): string {
  const dev = (id: unknown) => devices.find((d) => d.id === Number(id))?.name ?? '?';
  switch (item.type) {
    case 'device_status':
      return `"${dev(item.device_id)}" ist ${item.status === 'on' ? 'an' : 'aus'}`;
    case 'temperature_above':
      return `Temp. (${dev(item.device_id)}) > ${item.threshold}°C`;
    case 'temperature_below':
      return `Temp. (${dev(item.device_id)}) < ${item.threshold}°C`;
    case 'humidity_above':
      return `Feuchte (${dev(item.device_id)}) > ${item.threshold}%`;
    case 'humidity_below':
      return `Feuchte (${dev(item.device_id)}) < ${item.threshold}%`;
    case 'door_open':
      return `"${dev(item.device_id)}" ist offen`;
    case 'door_closed':
      return `"${dev(item.device_id)}" ist geschlossen`;
    case 'motion':
      return `"${dev(item.device_id)}" erkennt Bewegung`;
    case 'time_between': {
      const fromDate = item.from_date != null ? String(item.from_date) : '';
      const toDate = item.to_date != null ? String(item.to_date) : '';
      if (fromDate && toDate) {
        return `${formatDeDate(fromDate)} ${item.from}–${formatDeDate(toDate)} ${item.to}`;
      }
      return `Zeit ${item.from}–${item.to}`;
    }
    case 'time_at':
      return `Uhrzeit ${item.time}`;
    case 'sunrise':
    case 'sunset': {
      const off = Number(item.offset_minutes ?? 0);
      const label = item.type === 'sunrise' ? 'Sonnenaufgang' : 'Sonnenuntergang';
      if (!off) return label;
      return `${label} ${off > 0 ? '+' : ''}${off} Min`;
    }
    case 'weekday': {
      const days = ((item.weekdays as number[]) ?? [])
        .sort()
        .map((d) => DAYS_SHORT[d % 7])
        .join(', ');
      return `Wochentag: ${days}`;
    }
    case 'child_lock':
      return `"${dev(item.device_id)}" Kindersicherung ${String(item.value).toUpperCase() === 'LOCK' ? 'an' : 'aus'}`;
    case 'open_window':
      return `"${dev(item.device_id)}" Offenes-Fenster ${String(item.value).toUpperCase() === 'ON' ? 'an' : 'aus'}`;
    default:
      return 'Bedingung';
  }
}

function describeConditions(
  conditions: { logic?: string; items?: Record<string, unknown>[] } | null | undefined,
  devices: Device[],
): string | null {
  const items = conditions?.items ?? [];
  if (items.length === 0) return null;
  const joiner = conditions?.logic === 'or' ? ' ODER ' : ' UND ';
  return items.map((item) => describeConditionItem(item, devices)).join(joiner);
}

function describeTrigger(trigger: Record<string, unknown>, devices: Device[]): string {
  const dev = (id: unknown) => devices.find((d) => d.id === Number(id))?.name ?? '?';
  switch (trigger.type) {
    case 'interlock':
      return 'Sperre';
    case 'time':
      return `Taeglich um ${trigger.time} Uhr`;
    case 'weekday_time': {
      const days = ((trigger.weekdays as number[]) ?? [])
        .sort()
        .map((d) => DAYS_SHORT[d % 7])
        .join(', ');
      return `${days} um ${trigger.time} Uhr`;
    }
    case 'device_status':
      return `Wenn "${dev(trigger.device_id)}" ${trigger.status === 'on' ? 'eingeschaltet' : 'ausgeschaltet'} wird`;
    case 'temperature_above':
      return `Temperatur (${dev(trigger.device_id)}) > ${trigger.threshold}°C`;
    case 'temperature_below':
      return `Temperatur (${dev(trigger.device_id)}) < ${trigger.threshold}°C`;
    case 'humidity_above':
      return `Luftfeuchtigkeit (${dev(trigger.device_id)}) > ${trigger.threshold}%`;
    case 'humidity_below':
      return `Luftfeuchtigkeit (${dev(trigger.device_id)}) < ${trigger.threshold}%`;
    case 'motion':
      return `Bewegung erkannt (${dev(trigger.device_id)})`;
    case 'door_open':
      return `Tuer/Fenster geoeffnet (${dev(trigger.device_id)})`;
    case 'door_closed':
      return `Tuer/Fenster geschlossen (${dev(trigger.device_id)})`;
    case 'device_on_duration':
      return `"${dev(trigger.device_id)}" seit ${trigger.minutes} Min. eingeschaltet`;
    case 'flood':
      return `Wasseralarm (${dev(trigger.device_id)})`;
    case 'smoke':
      return `Rauchalarm (${dev(trigger.device_id)})`;
    case 'battery_low':
      return `Batterie niedrig (${dev(trigger.device_id)}) < ${trigger.threshold}%`;
    case 'power_above':
      return `Leistung (${dev(trigger.device_id)}) > ${trigger.threshold} W`;
    default:
      return 'Unbekannt';
  }
}

function describeActionItem(
  action: Record<string, unknown>,
  devices: Device[],
  rooms: Room[],
  scenes: Scene[] = [],
): string {
  const dev = (id: unknown) => devices.find((d) => d.id === Number(id))?.name ?? '?';
  const room = (id: unknown) => rooms.find((r) => r.id === Number(id))?.name ?? '?';
  const scene = (id: unknown) => scenes.find((s) => s.id === Number(id))?.name ?? '?';
  switch (action.type) {
    case 'block_command':
      return `"${dev(action.device_id)}" nicht ${statusActionLabel(action.status)}`;
    case 'set_device_status':
      return `"${dev(action.device_id)}" ${statusActionLabel(action.status)}`;
    case 'toggle_device':
      return `"${dev(action.device_id)}" umschalten`;
    case 'set_room_devices':
      return `Alle Geraete in "${room(action.room_id)}" ${action.status === 'on' ? 'einschalten' : 'ausschalten'}`;
    case 'delayed_off':
      return `"${dev(action.device_id)}" nach ${action.minutes} Min. ausschalten`;
    case 'delayed_on':
      return `"${dev(action.device_id)}" nach ${action.minutes} Min. einschalten`;
    case 'set_thermostat_setpoint':
      return `"${dev(action.device_id)}" Sollwert ${action.setpoint}°C`;
    case 'set_thermostat_mode': {
      const modeLabel =
        action.mode === 'heat' ? 'Heizen' : action.mode === 'off' ? 'Aus' : action.mode === 'auto' ? 'Auto' : String(action.mode);
      return `"${dev(action.device_id)}" Modus ${modeLabel}`;
    }
    case 'set_thermostat_child_lock':
      return `"${dev(action.device_id)}" Kindersicherung ${action.locked ? 'an' : 'aus'}`;
    case 'set_thermostat_open_window':
      return `"${dev(action.device_id)}" Offenes-Fenster ${action.enabled ? 'an' : 'aus'}`;
    case 'set_thermostat_calibration':
      return `"${dev(action.device_id)}" Kalibrierung ${action.value}°C`;
    case 'set_thermostat_frost_protection':
      return `"${dev(action.device_id)}" Frostschutz ${action.value}°C`;
    case 'activate_scene':
      return `Szene "${scene(action.scene_id)}" aktivieren`;
    case 'notify':
      return `Benachrichtigung: "${action.message}"`;
    default:
      return 'Unbekannt';
  }
}

function describeAction(
  action: Record<string, unknown>,
  devices: Device[],
  rooms: Room[],
  scenes: Scene[] = [],
): string {
  if (action.type === 'multi' && Array.isArray(action.actions)) {
    return (action.actions as Record<string, unknown>[])
      .map((a) => describeActionItem(a, devices, rooms, scenes))
      .join(' + ');
  }
  return describeActionItem(action, devices, rooms, scenes);
}

function unwrapActions(action: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!action) return [];
  if (action.type === 'multi' && Array.isArray(action.actions)) {
    return action.actions as Record<string, unknown>[];
  }
  return [action];
}

function collectDeviceIds(a: Automation): number[] {
  const ids = new Set<number>();
  const add = (v: unknown) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  };
  add(a.trigger?.device_id);
  for (const item of a.conditions?.items ?? []) add(item.device_id);
  for (const ac of unwrapActions(a.action)) add(ac.device_id);
  return [...ids];
}

function collectDirectRoomIds(a: Automation): number[] {
  const ids = new Set<number>();
  for (const ac of unwrapActions(a.action)) {
    if (ac.type === 'set_room_devices' && ac.room_id != null) {
      const n = Number(ac.room_id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }
  return [...ids];
}

function roomIdsForAutomation(a: Automation, devices: Device[]): number[] {
  const fromDevices = collectDeviceIds(a)
    .map((id) => devices.find((d) => d.id === id)?.room_id)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  return [...new Set([...fromDevices, ...collectDirectRoomIds(a)])];
}

type RoomGroupItem = { automation: Automation; otherRoomNames: string[] };
type RoomGroup = { key: string; room: Room | null; items: RoomGroupItem[] };

function groupAutomationsByRoom(
  list: Automation[],
  devices: Device[],
  rooms: Room[],
): RoomGroup[] {
  const nameOf = (id: number) => rooms.find((r) => r.id === id)?.name ?? `Raum ${id}`;
  const byRoom = new Map<number, RoomGroupItem[]>();
  const none: RoomGroupItem[] = [];

  for (const a of list) {
    const ids = roomIdsForAutomation(a, devices);
    if (ids.length === 0) {
      none.push({ automation: a, otherRoomNames: [] });
      continue;
    }
    for (const id of ids) {
      const otherRoomNames = ids.filter((x) => x !== id).map(nameOf);
      const bucket = byRoom.get(id) ?? [];
      bucket.push({ automation: a, otherRoomNames });
      byRoom.set(id, bucket);
    }
  }

  const groups: RoomGroup[] = [];
  const used = new Set<number>();
  for (const room of rooms) {
    const items = byRoom.get(room.id);
    if (!items?.length) continue;
    groups.push({ key: String(room.id), room, items });
    used.add(room.id);
  }
  for (const [id, items] of byRoom) {
    if (used.has(id)) continue;
    groups.push({
      key: String(id),
      room: { id, name: `Raum ${id}`, icon: '🏠' },
      items,
    });
  }
  if (none.length) groups.push({ key: 'none', room: null, items: none });
  return groups;
}

function AutomationCard({
  automation,
  devices,
  rooms,
  scenes,
  extraBadge,
  isLock = false,
  onToggle,
  onEdit,
  onDelete,
}: {
  automation: Automation;
  devices: Device[];
  rooms: Room[];
  scenes: Scene[];
  extraBadge?: string;
  isLock?: boolean;
  onToggle: (a: Automation) => void;
  onEdit: (a: Automation) => void;
  onDelete: (a: Automation) => void;
}) {
  const trigger = automation.trigger as Record<string, unknown>;
  const action = automation.action as Record<string, unknown>;
  const condText = describeConditions(automation.conditions, devices);
  const wennText = isLock ? (condText ?? 'Bedingung') : (condText ?? describeTrigger(trigger, devices));
  const WennIcon = isLock || condText ? Filter : getTriggerIcon(trigger.type as string);

  return (
    <Card className={!automation.enabled ? 'opacity-60' : ''}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {isLock && <Shield className="h-4 w-4 text-muted-foreground shrink-0" />}
          <CardTitle className="text-base truncate">{automation.name}</CardTitle>
          {!automation.enabled && (
            <Badge variant="secondary" className="text-xs shrink-0">Deaktiviert</Badge>
          )}
          {extraBadge && (
            <Badge variant="outline" className="text-xs shrink-0 max-w-[14rem] truncate" title={extraBadge}>
              {extraBadge}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <Switch checked={automation.enabled} onCheckedChange={() => onToggle(automation)} />
          <Button variant="ghost" size="icon" onClick={() => onEdit(automation)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive"
            onClick={() => onDelete(automation)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="flex items-center gap-1 text-muted-foreground">
            <WennIcon className="h-3.5 w-3.5 shrink-0" />
            {wennText}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium">{describeAction(action, devices, rooms, scenes)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function AutomationList({
  items,
  groups,
  view,
  empty,
  isLock = false,
  devices,
  rooms,
  scenes,
  onToggle,
  onEdit,
  onDelete,
}: {
  items: Automation[];
  groups: RoomGroup[];
  view: 'flat' | 'byRoom';
  empty: ReactNode;
  isLock?: boolean;
  devices: Device[];
  rooms: Room[];
  scenes: Scene[];
  onToggle: (a: Automation) => void;
  onEdit: (a: Automation) => void;
  onDelete: (a: Automation) => void;
}) {
  if (items.length === 0) return <>{empty}</>;

  const card = (automation: Automation, extraBadge?: string, key?: string) => (
    <AutomationCard
      key={key ?? String(automation.id)}
      automation={automation}
      devices={devices}
      rooms={rooms}
      scenes={scenes}
      extraBadge={extraBadge}
      isLock={isLock}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );

  if (view === 'flat') {
    return <div className="space-y-3">{items.map((a) => card(a))}</div>;
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key} className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span>{g.room ? `${g.room.icon ?? '🏠'} ${g.room.name}` : 'Ohne Raum'}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {g.items.length}
            </span>
          </h2>
          {g.items.map(({ automation, otherRoomNames }) =>
            card(
              automation,
              otherRoomNames.length ? `auch in ${otherRoomNames.join(', ')}` : undefined,
              `${g.key}-${automation.id}`,
            ))}
        </div>
      ))}
    </div>
  );
}

function getTriggerIcon(type: string) {
  if (type === 'time' || type === 'weekday_time' || type === 'time_at' || type === 'sunrise' || type === 'sunset') return Clock;
  if (type === 'temperature_above' || type === 'temperature_below') return Thermometer;
  if (type === 'humidity_above' || type === 'humidity_below') return Droplets;
  if (type === 'motion') return Activity;
  if (type === 'door_open' || type === 'door_closed') return DoorOpen;
  if (type === 'device_on_duration') return Timer;
  if (type === 'flood') return Waves;
  if (type === 'smoke') return Flame;
  if (type === 'battery_low') return Battery;
  if (type === 'power_above') return Gauge;
  if (type === 'conditions') return Filter;
  if (type === 'interlock') return Shield;
  return Zap;
}

function actionIsComplete(a: ActionFormItem): boolean {
  if (['set_device_status', 'toggle_device', 'delayed_off', 'delayed_on',
    'set_thermostat_setpoint', 'set_thermostat_mode',
    'set_thermostat_child_lock', 'set_thermostat_open_window',
    'set_thermostat_calibration', 'set_thermostat_frost_protection',
  ].includes(a.type) && !!a.deviceId) return true;
  if (a.type === 'set_room_devices' && !!a.roomId) return true;
  if (a.type === 'activate_scene' && !!a.sceneId) return true;
  if (a.type === 'notify' && !!a.notifyMessage.trim()) return true;
  return false;
}

// ── Hilfs-Komponenten ─────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
      {children}
    </label>
  );
}

function TextInput({
  value, onChange, placeholder, type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function DeviceSelect({
  value, onChange, devices, rooms, placeholder = 'Geraet waehlen...',
}: {
  value: string;
  onChange: (v: string) => void;
  devices: Device[];
  rooms: Room[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
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

function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
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
              'cursor-pointer px-2.5 py-1 text-xs rounded-md border font-medium transition-colors',
              value.includes(day)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-input text-muted-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => onChange([1, 2, 3, 4, 5])}>Werktags</button>
        <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => onChange([6, 0])}>Wochenende</button>
        <button type="button" className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => onChange([0, 1, 2, 3, 4, 5, 6])}>Taeglich</button>
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  initialAutomations: Automation[];
  devices: Device[];
  rooms: Room[];
  scenes: Scene[];
  initialLogs: AutomationLog[];
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function AutomationsClient({ initialAutomations, devices: devicesProp, rooms: roomsProp, scenes: scenesProp, initialLogs }: Props) {
  const router = useRouter();
  const storeDevices = useSmartHomeStore(s => s.devices);
  const storeRooms = useSmartHomeStore(s => s.rooms);
  const storeScenes = useSmartHomeStore(s => s.scenes);
  const devices = devicesProp.length ? devicesProp : storeDevices;
  const rooms = roomsProp.length ? roomsProp : storeRooms;
  const scenes = scenesProp.length ? scenesProp : storeScenes;
  const [automations, setAutomations] = useState(initialAutomations);
  const [logs, setLogs]               = useState<AutomationLog[]>(initialLogs);
  const [activeTab, setActiveTab]     = useState<'automations' | 'locks' | 'history'>('automations');
  const [listView, setListView]       = useState<'flat' | 'byRoom'>('flat');

  const [dialog, setDialog] = useState<{
    open: boolean;
    editing?: Automation;
    form: FormState;
    saving: boolean;
    error: string;
  }>({ open: false, form: emptyForm(), saving: false, error: '' });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    id: number;
    name: string;
  } | null>(null);

  const patchForm = (patch: Partial<FormState>) =>
    setDialog((s) => ({ ...s, form: { ...s.form, ...patch } }));

  const patchAction = (id: string, patch: Partial<ActionFormItem>) => {
    setDialog((s) => ({
      ...s,
      form: {
        ...s.form,
        actions: s.form.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      },
    }));
  };

  // Echtzeit-Updates: neuer Log-Eintrag wenn Automation feuert
  useEffect(() => {
    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('automations').listen('.automation.fired', (data: {
        name: string; summary: string;
      }) => {
        const entry: AutomationLog = {
          id: Date.now(),
          automation_id: null,
          automation_name: data.name,
          action_summary: data.summary,
          fired_at: new Date().toISOString(),
        };
        setLogs(prev => [entry, ...prev].slice(0, 200));
      });
    } catch { /* Reverb nicht erreichbar */ }
    return () => { if (echo) echo.leaveChannel('automations'); };
  }, []);

  const handleToggle = async (automation: Automation) => {
    const updated = await api.updateAutomation(automation.id, { enabled: !automation.enabled });
    setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const validate = (f: FormState): string => {
    if (!f.name.trim()) return 'Name ist erforderlich.';
    if (f.conditions.length < 1) return 'Mindestens eine Bedingung ist erforderlich.';
    if (f.kind === 'lock') {
      if (!f.blockDeviceId) return 'Bitte ein Gerät wählen, das gesperrt werden soll.';
      if (!f.blockStatus) return 'Bitte den verbotenen Befehl wählen.';
    } else if (f.actions.length < 1) {
      return 'Mindestens eine Aktion ist erforderlich.';
    }

    for (let i = 0; i < f.conditions.length; i++) {
      const c = f.conditions[i];
      const label = `Bedingung ${i + 1}`;
      const needsCondDevice: ConditionType[] = [
        'device_status', 'temperature_above', 'temperature_below',
        'humidity_above', 'humidity_below', 'door_open', 'door_closed', 'motion',
        'child_lock', 'open_window',
      ];
      if (needsCondDevice.includes(c.type) && !c.deviceId)
        return `${label}: bitte ein Geraet waehlen.`;
      if (c.type === 'weekday' && c.weekdays.length === 0)
        return `${label}: bitte mindestens einen Wochentag waehlen.`;
      if (c.type === 'time_between' && (!c.from || !c.to))
        return `${label}: bitte Zeit von/bis angeben.`;
      if (c.type === 'time_between' && c.useDates) {
        if (!c.fromDate || !c.toDate)
          return `${label}: bitte Datum von/bis angeben.`;
        const fromTs = Date.parse(`${c.fromDate}T${c.from}`);
        const toTs = Date.parse(`${c.toDate}T${c.to}`);
        if (Number.isNaN(fromTs) || Number.isNaN(toTs))
          return `${label}: ungueltiges Datum/Zeit.`;
        if (fromTs > toTs)
          return `${label}: Von muss vor Bis liegen.`;
      }
      if (c.type === 'time_at' && !c.time)
        return `${label}: bitte eine Uhrzeit angeben.`;
      if ((c.type === 'sunrise' || c.type === 'sunset')) {
        const off = Number(c.offsetMinutes);
        if (!Number.isFinite(off) || off < -120 || off > 120)
          return `${label}: Offset muss zwischen -120 und +120 Minuten liegen.`;
      }
      if ((c.type === 'child_lock' || c.type === 'open_window') && !c.value)
        return `${label}: bitte einen Wert waehlen.`;
    }

    const needsActionDevice: ActionType[] = [
      'set_device_status', 'toggle_device', 'delayed_off', 'delayed_on',
      'set_thermostat_setpoint', 'set_thermostat_mode',
      'set_thermostat_child_lock', 'set_thermostat_open_window',
      'set_thermostat_calibration', 'set_thermostat_frost_protection',
    ];

    if (f.kind !== 'lock') {
    for (let i = 0; i < f.actions.length; i++) {
      const a = f.actions[i];
      const label = `Aktion ${i + 1}`;
      if (a.type === 'set_room_devices' && !a.roomId)
        return `${label}: bitte einen Raum waehlen.`;
      if (needsActionDevice.includes(a.type) && !a.deviceId)
        return `${label}: bitte ein Ziel-Geraet waehlen.`;
      if (a.type === 'activate_scene' && !a.sceneId)
        return `${label}: bitte eine Szene waehlen.`;
      if (a.type === 'set_thermostat_setpoint') {
        const sp = Number(a.setpoint);
        if (Number.isNaN(sp) || sp < 4 || sp > 35)
          return `${label}: Sollwert muss zwischen 4 und 35°C liegen.`;
      }
      if (a.type === 'set_thermostat_calibration') {
        const v = Number(a.calibration);
        if (Number.isNaN(v) || v < -12.7 || v > 12.7)
          return `${label}: Kalibrierung muss zwischen -12.7 und 12.7°C liegen.`;
      }
      if (a.type === 'set_thermostat_frost_protection') {
        const v = Number(a.frostProtection);
        if (Number.isNaN(v) || v < 4 || v > 35)
          return `${label}: Frostschutz muss zwischen 4 und 35°C liegen.`;
      }
      if (a.type === 'notify' && !a.notifyMessage.trim())
        return `${label}: bitte eine Benachrichtigungs-Nachricht eingeben.`;
    }
    }
    return '';
  };

  const save = async () => {
    const { form, editing } = dialog;
    const err = validate(form);
    if (err) { setDialog((s) => ({ ...s, error: err })); return; }
    setDialog((s) => ({ ...s, saving: true, error: '' }));
    try {
      const payload = form.kind === 'lock'
        ? {
            name: form.name.trim(),
            trigger: { type: 'interlock' },
            action: {
              type: 'block_command',
              device_id: Number(form.blockDeviceId),
              status: form.blockStatus,
            },
            conditions: buildConditions(form),
          }
        : {
            name: form.name.trim(),
            trigger: { type: 'conditions' },
            action: buildAction(form),
            conditions: buildConditions(form),
          };
      if (editing) {
        const updated = await api.updateAutomation(editing.id, payload);
        setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        const created = await api.createAutomation({ ...payload, enabled: true });
        setAutomations((prev) => [...prev, created]);
      }
      setDialog({ open: false, form: emptyForm(), saving: false, error: '' });
    } catch {
      setDialog((s) => ({ ...s, saving: false, error: 'Speichern fehlgeschlagen.' }));
    }
  };

  const deleteAutomation = async (id: number) => {
    await api.deleteAutomation(id);
    setAutomations((prev) => prev.filter((a) => a.id !== id));
    setDeleteConfirm(null);
  };

  const tempSensors = devices.filter((d) => d.type === 'sensor_temperature' || d.type === 'thermostat');
  const humiditySensors = devices.filter((d) =>
    d.type === 'sensor_humidity' || d.attributes?.humidity != null
  );
  const motionSensors = devices.filter((d) => d.type === 'sensor_motion');
  const doorSensors = devices.filter((d) => d.type === 'sensor_door');
  const thermostats = devices.filter((d) => d.type === 'thermostat');
  const switchableDevices = devices.filter((d) => SWITCHABLE_TYPES.includes(d.type));

  const regularAutomations = automations.filter((a) => !isInterlockAutomation(a));
  const lockAutomations = automations.filter((a) => isInterlockAutomation(a));
  const regularByRoom = useMemo(
    () => groupAutomationsByRoom(
      automations.filter((a) => !isInterlockAutomation(a)),
      devices,
      rooms,
    ),
    [automations, devices, rooms],
  );
  const locksByRoom = useMemo(
    () => groupAutomationsByRoom(
      automations.filter((a) => isInterlockAutomation(a)),
      devices,
      rooms,
    ),
    [automations, devices, rooms],
  );
  const blockableDevices = devices.filter((d) =>
    [...SWITCHABLE_TYPES, 'thermostat'].includes(d.type)
  );
  const { form } = dialog;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push('/settings')}
            className="cursor-pointer h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-all"
            aria-label="Zurück zu Einstellungen"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">Automationen</h1>
        </div>
        {activeTab === 'automations' && (
          <Button size="sm" onClick={() => setDialog({ open: true, form: emptyForm(), saving: false, error: '' })}>
            <Plus className="h-4 w-4 mr-1" /> Neue Automation
          </Button>
        )}
        {activeTab === 'locks' && (
          <Button size="sm" onClick={() => setDialog({ open: true, form: { ...emptyForm(), kind: 'lock' }, saving: false, error: '' })}>
            <Plus className="h-4 w-4 mr-1" /> Neue Sperre
          </Button>
        )}
      </div>

      {/* ── Tab-Navigation ─────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg border p-1 w-fit">
        <button
          onClick={() => setActiveTab('automations')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'automations'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Automationen
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {regularAutomations.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('locks')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'locks'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Shield className="h-3.5 w-3.5" />
          Sperren
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {lockAutomations.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'history'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <History className="h-3.5 w-3.5" />
          Verlauf
          {logs.length > 0 && (
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {logs.length}
            </span>
          )}
        </button>
      </div>

      {activeTab !== 'history' && (
        <div className="flex gap-1 rounded-lg border p-1 w-fit">
          <button
            type="button"
            onClick={() => setListView('flat')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              listView === 'flat'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <List className="h-3.5 w-3.5" />
            Liste
          </button>
          <button
            type="button"
            onClick={() => setListView('byRoom')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              listView === 'byRoom'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Nach Räumen
          </button>
        </div>
      )}

      {/* ── Verlauf-Tab ────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-2">
          {logs.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Noch keine Automationen ausgefuehrt.
            </p>
          )}
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
              <div className="rounded-lg bg-amber-500/10 p-1.5 shrink-0 mt-0.5">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">{log.automation_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{log.action_summary}</p>
              </div>
              <time
                className="text-xs text-muted-foreground shrink-0 tabular-nums"
                title={new Date(log.fired_at).toLocaleString('de-DE')}
              >
                {new Date(log.fired_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                {' '}
                <span className="hidden sm:inline">
                  {new Date(log.fired_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                </span>
              </time>
            </div>
          ))}
        </div>
      )}

      {/* ── Automationen-Tab ───────────────────────────────────────────── */}
      {activeTab === 'automations' && (
        <AutomationList
          items={regularAutomations}
          groups={regularByRoom}
          view={listView}
          empty={<p className="text-muted-foreground text-sm">Noch keine Automationen vorhanden.</p>}
          devices={devices}
          rooms={rooms}
          scenes={scenes}
          onToggle={handleToggle}
          onEdit={(a) => setDialog({ open: true, editing: a, form: automationToForm(a), saving: false, error: '' })}
          onDelete={(a) => setDeleteConfirm({ open: true, id: a.id, name: a.name })}
        />
      )}

      {activeTab === 'locks' && (
        <AutomationList
          items={lockAutomations}
          groups={locksByRoom}
          view={listView}
          isLock
          empty={
            <p className="text-muted-foreground text-sm">
              Noch keine Sperren. Kopple Geräte, z.B. PC an → Steckdose nicht aus.
            </p>
          }
          devices={devices}
          rooms={rooms}
          scenes={scenes}
          onToggle={handleToggle}
          onEdit={(a) => setDialog({ open: true, editing: a, form: automationToForm(a), saving: false, error: '' })}
          onDelete={(a) => setDeleteConfirm({ open: true, id: a.id, name: a.name })}
        />
      )}

      {/* ── Automations-Dialog ─────────────────────────────────────────── */}
      <Dialog open={dialog.open} onOpenChange={(open) => {
        if (!open) setDialog((s) => ({ ...s, open: false }));
      }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.kind === 'lock'
                ? (dialog.editing ? 'Sperre bearbeiten' : 'Neue Sperre')
                : (dialog.editing ? 'Automation bearbeiten' : 'Neue Automation')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name */}
            <div className="space-y-1">
              <FieldLabel>Name</FieldLabel>
              <TextInput value={form.name} onChange={(v) => patchForm({ name: v })} placeholder={form.kind === 'lock' ? 'z.B. PC schützt Steckdose' : 'z.B. Nachtmodus'} />
            </div>

            {/* BEDINGUNGEN (einziger Wenn-Block) */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Filter className="h-4 w-4" /> Wenn ...
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => patchForm({ conditions: [...form.conditions, newCondition()] })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Bedingung
                </Button>
              </div>

              {form.conditions.length > 1 && (
                <div className="space-y-1">
                  <FieldLabel>Verknuepfung</FieldLabel>
                  <Select
                    value={form.conditionLogic}
                    onValueChange={(v) => patchForm({ conditionLogic: v as ConditionLogic })}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="and">ALLE Bedingungen (UND)</SelectItem>
                      <SelectItem value="or">EINE Bedingung reicht (ODER)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.conditions.map((cond, idx) => {
                const patchCond = (patch: Partial<ConditionFormItem>) => {
                  const next = form.conditions.map((c) => (c.id === cond.id ? { ...c, ...patch } : c));
                  patchForm({ conditions: next });
                };
                const removeCond = () => {
                  if (form.conditions.length <= 1) return;
                  patchForm({ conditions: form.conditions.filter((c) => c.id !== cond.id) });
                };

                const condNeedsTemp = cond.type === 'temperature_above' || cond.type === 'temperature_below';
                const condNeedsHum = cond.type === 'humidity_above' || cond.type === 'humidity_below';
                const condNeedsDoor = cond.type === 'door_open' || cond.type === 'door_closed';
                const condNeedsThermo = cond.type === 'child_lock' || cond.type === 'open_window';
                const condDeviceList = condNeedsTemp
                  ? tempSensors
                  : condNeedsHum
                    ? humiditySensors
                    : condNeedsDoor
                      ? doorSensors
                      : cond.type === 'motion'
                        ? motionSensors
                        : condNeedsThermo
                          ? thermostats
                          : devices;

                return (
                  <div key={cond.id} className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Bedingung {idx + 1}
                        {idx > 0 && (
                          <span className="ml-2 normal-case">
                            ({form.conditionLogic === 'or' ? 'ODER' : 'UND'})
                          </span>
                        )}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        disabled={form.conditions.length <= 1}
                        onClick={removeCond}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <FieldLabel>Typ</FieldLabel>
                      <Select
                        value={cond.type}
                        onValueChange={(v) => {
                          const type = v as ConditionType;
                          const patch: Partial<ConditionFormItem> = { type, deviceId: '' };
                          if (type === 'temperature_above' || type === 'temperature_below') patch.threshold = '22';
                          if (type === 'humidity_above' || type === 'humidity_below') patch.threshold = '70';
                          if (type === 'time_at') patch.time = '08:00';
                          if (type === 'sunrise' || type === 'sunset') patch.offsetMinutes = '0';
                          if (type === 'child_lock') patch.value = 'LOCK';
                          if (type === 'open_window') patch.value = 'ON';
                          patchCond(patch);
                        }}
                      >
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Zeit</SelectLabel>
                            <SelectItem value="time_at">Uhrzeit (HH:MM)</SelectItem>
                            <SelectItem value="time_between">Zeitfenster</SelectItem>
                            <SelectItem value="weekday">Wochentag</SelectItem>
                            <SelectItem value="sunrise">Sonnenaufgang</SelectItem>
                            <SelectItem value="sunset">Sonnenuntergang</SelectItem>
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Geraet / Sensor</SelectLabel>
                            <SelectItem value="device_status">Geraet ist an/aus</SelectItem>
                            <SelectItem value="temperature_above">Temperatur ueber</SelectItem>
                            <SelectItem value="temperature_below">Temperatur unter</SelectItem>
                            <SelectItem value="humidity_above">Feuchte ueber</SelectItem>
                            <SelectItem value="humidity_below">Feuchte unter</SelectItem>
                            <SelectItem value="door_open">Tuer/Fenster ist offen</SelectItem>
                            <SelectItem value="door_closed">Tuer/Fenster ist geschlossen</SelectItem>
                            <SelectItem value="motion">Bewegung aktiv</SelectItem>
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Thermostat</SelectLabel>
                            <SelectItem value="child_lock">Kindersicherung</SelectItem>
                            <SelectItem value="open_window">Offenes-Fenster</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    {cond.type === 'device_status' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Geraet</FieldLabel>
                          <DeviceSelect value={cond.deviceId} onChange={(v) => patchCond({ deviceId: v })}
                            devices={switchableDevices} rooms={rooms} />
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Status</FieldLabel>
                          <Select value={cond.status} onValueChange={(v) => patchCond({ status: v as DeviceStatus })}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="on">an</SelectItem>
                              <SelectItem value="off">aus</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {(condNeedsTemp || condNeedsHum) && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Geraet</FieldLabel>
                          {condDeviceList.length > 0 ? (
                            <DeviceSelect value={cond.deviceId} onChange={(v) => patchCond({ deviceId: v })}
                              devices={condDeviceList} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine passenden Geraete.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Schwellwert</FieldLabel>
                          <TextInput type="number" value={cond.threshold}
                            onChange={(v) => patchCond({ threshold: v })} />
                        </div>
                      </div>
                    )}

                    {(condNeedsDoor || cond.type === 'motion') && (
                      <div className="space-y-1">
                        <FieldLabel>Geraet</FieldLabel>
                        {condDeviceList.length > 0 ? (
                          <DeviceSelect value={cond.deviceId} onChange={(v) => patchCond({ deviceId: v })}
                            devices={condDeviceList} rooms={rooms} />
                        ) : (
                          <p className="text-xs text-muted-foreground py-2">Keine passenden Sensoren.</p>
                        )}
                      </div>
                    )}

                    {cond.type === 'time_at' && (
                      <div className="space-y-1">
                        <FieldLabel>Uhrzeit</FieldLabel>
                        <input type="time"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          value={cond.time} onChange={(e) => patchCond({ time: e.target.value })} />
                      </div>
                    )}

                    {(cond.type === 'sunrise' || cond.type === 'sunset') && (
                      <div className="space-y-1">
                        <FieldLabel>Offset (Minuten)</FieldLabel>
                        <TextInput
                          type="number"
                          value={cond.offsetMinutes}
                          onChange={(v) => patchCond({ offsetMinutes: v })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Negativ = früher, positiv = später (−120…+120). Stadt aus Wetter-Einstellungen.
                        </p>
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
                              patchCond({
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
                              <input type="date"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                value={cond.fromDate}
                                onChange={(e) => patchCond({ fromDate: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <FieldLabel>Bis Datum</FieldLabel>
                              <input type="date"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                value={cond.toDate}
                                onChange={(e) => patchCond({ toDate: e.target.value })} />
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <FieldLabel>Von</FieldLabel>
                            <input type="time"
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              value={cond.from} onChange={(e) => patchCond({ from: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <FieldLabel>Bis</FieldLabel>
                            <input type="time"
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              value={cond.to} onChange={(e) => patchCond({ to: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    )}

                    {cond.type === 'weekday' && (
                      <div className="space-y-1">
                        <FieldLabel>Wochentage</FieldLabel>
                        <WeekdayPicker value={cond.weekdays} onChange={(v) => patchCond({ weekdays: v })} />
                      </div>
                    )}

                    {(cond.type === 'child_lock' || cond.type === 'open_window') && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={cond.deviceId} onChange={(v) => patchCond({ deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Wert</FieldLabel>
                          {cond.type === 'child_lock' ? (
                            <Select value={cond.value} onValueChange={(v) => patchCond({ value: v })}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="LOCK">LOCK (an)</SelectItem>
                                <SelectItem value="UNLOCK">UNLOCK (aus)</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select value={cond.value} onValueChange={(v) => patchCond({ value: v })}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ON">ON</SelectItem>
                                <SelectItem value="OFF">OFF</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {form.kind === 'lock' && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Shield className="h-4 w-4" /> dann darf nicht ...
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Gerät</FieldLabel>
                    {blockableDevices.length > 0 ? (
                      <DeviceSelect
                        value={form.blockDeviceId}
                        onChange={(v) => {
                          const d = devices.find((x) => String(x.id) === v);
                          let status = form.blockStatus;
                          if (d?.type === 'thermostat' && (status === 'on' || status === 'open' || status === 'close')) status = 'heat';
                          if (d?.type === 'cover' || d?.type === 'valve') {
                            if (status === 'on' || status === 'heat') status = 'open';
                            if (status === 'off') status = 'close';
                          }
                          if (d && d.type !== 'thermostat' && d.type !== 'cover' && d.type !== 'valve' && (status === 'heat' || status === 'open' || status === 'close')) {
                            status = status === 'close' ? 'off' : 'on';
                          }
                          patchForm({ blockDeviceId: v, blockStatus: status });
                        }}
                        devices={blockableDevices}
                        rooms={rooms}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Keine schaltbaren Geräte.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Verbotener Befehl</FieldLabel>
                    <Select
                      value={form.blockStatus}
                      onValueChange={(v) => patchForm({ blockStatus: v as FormState['blockStatus'] })}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const d = devices.find((x) => String(x.id) === form.blockDeviceId);
                          if (d?.type === 'thermostat') {
                            return (
                              <>
                                <SelectItem value="heat">Heizen / einschalten</SelectItem>
                                <SelectItem value="off">Ausschalten</SelectItem>
                              </>
                            );
                          }
                          if (d?.type === 'cover' || d?.type === 'valve') {
                            return (
                              <>
                                <SelectItem value="open">Öffnen</SelectItem>
                                <SelectItem value="close">Schließen</SelectItem>
                              </>
                            );
                          }
                          return (
                            <>
                              <SelectItem value="on">Einschalten</SelectItem>
                              <SelectItem value="off">Ausschalten</SelectItem>
                            </>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* AKTIONEN */}
            {form.kind !== 'lock' && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <ChevronRight className="h-4 w-4" /> Dann ...
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => patchForm({ actions: [...form.actions, newAction()] })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Aktion
                </Button>
              </div>

              {form.actions.map((action, idx) => {
                const actionTargetDevice = switchableDevices.find((d) => String(d.id) === action.deviceId);
                const actionTargetIsCover = actionTargetDevice?.type === 'cover';
                const actionTargetIsComputer = actionTargetDevice?.type === 'computer';
                const wakeOnlyDevices = switchableDevices.filter((d) => d.type !== 'computer');
                const removeAction = () => {
                  if (form.actions.length <= 1) return;
                  patchForm({ actions: form.actions.filter((a) => a.id !== action.id) });
                };

                return (
                  <div key={action.id} className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Aktion {idx + 1}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        disabled={form.actions.length <= 1}
                        onClick={removeAction}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <FieldLabel>Aktions-Typ</FieldLabel>
                      <Select value={action.type} onValueChange={(v) => {
                        const type = v as ActionType;
                        const patch: Partial<ActionFormItem> = { type };
                        if ((type === 'delayed_off' || type === 'toggle_device') && actionTargetIsComputer) {
                          patch.deviceId = '';
                        }
                        patchAction(action.id, patch);
                      }}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Geraet steuern</SelectLabel>
                            <SelectItem value="set_device_status">Geraet ein-/ausschalten</SelectItem>
                            <SelectItem value="toggle_device">Geraet umschalten (Toggle)</SelectItem>
                            <SelectItem value="delayed_off">Geraet nach X Minuten ausschalten</SelectItem>
                            <SelectItem value="delayed_on">Geraet nach X Minuten einschalten</SelectItem>
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Klima</SelectLabel>
                            <SelectItem value="set_thermostat_setpoint">Thermostat-Sollwert setzen</SelectItem>
                            <SelectItem value="set_thermostat_mode">Thermostat-Modus setzen</SelectItem>
                            <SelectItem value="set_thermostat_child_lock">Kindersicherung setzen</SelectItem>
                            <SelectItem value="set_thermostat_open_window">Offenes-Fenster setzen</SelectItem>
                            <SelectItem value="set_thermostat_calibration">Kalibrierung setzen</SelectItem>
                            <SelectItem value="set_thermostat_frost_protection">Frostschutz setzen</SelectItem>
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Raum / Szene</SelectLabel>
                            <SelectItem value="set_room_devices">Alle Geraete im Raum ein-/ausschalten</SelectItem>
                            <SelectItem value="activate_scene">Szene aktivieren</SelectItem>
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Sonstiges</SelectLabel>
                            <SelectItem value="notify">Benachrichtigung senden</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    {action.type === 'set_device_status' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Geraet</FieldLabel>
                          <DeviceSelect
                            value={action.deviceId}
                            onChange={(v) => {
                              const next = switchableDevices.find((d) => String(d.id) === v);
                              const patch: Partial<ActionFormItem> = { deviceId: v };
                              if (next?.type === 'cover' && !['open', 'close', 'stop'].includes(action.deviceStatus)) {
                                patch.deviceStatus = 'open';
                              } else if (next?.type === 'computer') {
                                patch.deviceStatus = 'on';
                              } else if (next && next.type !== 'cover' && ['open', 'close', 'stop'].includes(action.deviceStatus)) {
                                patch.deviceStatus = 'on';
                              }
                              patchAction(action.id, patch);
                            }}
                            devices={switchableDevices} rooms={rooms} />
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Aktion</FieldLabel>
                          <Select value={action.deviceStatus} onValueChange={(v) => patchAction(action.id, { deviceStatus: v as ActionDeviceStatus })}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {actionTargetIsCover ? (
                                <>
                                  <SelectItem value="open">oeffnen</SelectItem>
                                  <SelectItem value="close">schliessen</SelectItem>
                                  <SelectItem value="stop">stopp</SelectItem>
                                </>
                              ) : actionTargetIsComputer ? (
                                <SelectItem value="on">starten</SelectItem>
                              ) : (
                                <>
                                  <SelectItem value="on">einschalten</SelectItem>
                                  <SelectItem value="off">ausschalten</SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {action.type === 'toggle_device' && (
                      <div className="space-y-1">
                        <FieldLabel>Geraet</FieldLabel>
                        <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                          devices={wakeOnlyDevices} rooms={rooms} />
                      </div>
                    )}

                    {(action.type === 'delayed_off' || action.type === 'delayed_on') && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Geraet</FieldLabel>
                          <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                            devices={action.type === 'delayed_on' ? switchableDevices : wakeOnlyDevices} rooms={rooms} />
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Verzoegerung (Minuten)</FieldLabel>
                          <TextInput type="number" value={action.delayMinutes}
                            onChange={(v) => patchAction(action.id, { delayMinutes: v })} placeholder="10" />
                        </div>
                      </div>
                    )}

                    {action.type === 'set_room_devices' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Raum</FieldLabel>
                          <Select value={action.roomId} onValueChange={(v) => patchAction(action.id, { roomId: v })}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Raum waehlen..." /></SelectTrigger>
                            <SelectContent>
                              {rooms.map((r) => (
                                <SelectItem key={r.id} value={String(r.id)}>{r.icon} {r.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Aktion</FieldLabel>
                          <Select value={action.roomStatus} onValueChange={(v) => patchAction(action.id, { roomStatus: v as DeviceStatus })}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="on">alle einschalten</SelectItem>
                              <SelectItem value="off">alle ausschalten</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {action.type === 'set_thermostat_setpoint' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Sollwert (°C)</FieldLabel>
                          <TextInput type="number" value={action.setpoint}
                            onChange={(v) => patchAction(action.id, { setpoint: v })} placeholder="21" />
                          <p className="text-xs text-muted-foreground">4–35°C, Schritte 0.5</p>
                        </div>
                      </div>
                    )}

                    {action.type === 'set_thermostat_mode' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Modus</FieldLabel>
                          <Select value={action.thermostatMode} onValueChange={(v) => patchAction(action.id, { thermostatMode: v as ThermostatMode })}>
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="heat">Heizen</SelectItem>
                              <SelectItem value="off">Aus</SelectItem>
                              <SelectItem value="auto">Auto</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {action.type === 'set_thermostat_child_lock' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Kindersicherung</FieldLabel>
                          <Select
                            value={action.childLock ? 'true' : 'false'}
                            onValueChange={(v) => patchAction(action.id, { childLock: v === 'true' })}
                          >
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">an (LOCK)</SelectItem>
                              <SelectItem value="false">aus (UNLOCK)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {action.type === 'set_thermostat_open_window' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Offenes-Fenster</FieldLabel>
                          <Select
                            value={action.openWindow ? 'true' : 'false'}
                            onValueChange={(v) => patchAction(action.id, { openWindow: v === 'true' })}
                          >
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">an (ON)</SelectItem>
                              <SelectItem value="false">aus (OFF)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}

                    {action.type === 'set_thermostat_calibration' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Kalibrierung (°C)</FieldLabel>
                          <TextInput type="number" value={action.calibration}
                            onChange={(v) => patchAction(action.id, { calibration: v })} placeholder="0" />
                          <p className="text-xs text-muted-foreground">-12.7 bis 12.7°C</p>
                        </div>
                      </div>
                    )}

                    {action.type === 'set_thermostat_frost_protection' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <FieldLabel>Thermostat</FieldLabel>
                          {thermostats.length > 0 ? (
                            <DeviceSelect value={action.deviceId} onChange={(v) => patchAction(action.id, { deviceId: v })}
                              devices={thermostats} rooms={rooms} />
                          ) : (
                            <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Frostschutz (°C)</FieldLabel>
                          <TextInput type="number" value={action.frostProtection}
                            onChange={(v) => patchAction(action.id, { frostProtection: v })} placeholder="5" />
                          <p className="text-xs text-muted-foreground">4–35°C</p>
                        </div>
                      </div>
                    )}

                    {action.type === 'activate_scene' && (
                      <div className="space-y-1">
                        <FieldLabel>Szene</FieldLabel>
                        {scenes.length > 0 ? (
                          <Select value={action.sceneId} onValueChange={(v) => patchAction(action.id, { sceneId: v })}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Szene waehlen..." /></SelectTrigger>
                            <SelectContent>
                              {scenes.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                  <span className="inline-flex items-center gap-1.5">
                                    <Clapperboard className="h-3.5 w-3.5" />
                                    {s.icon ? `${s.icon} ` : ''}{s.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-xs text-muted-foreground py-2">Keine Szenen vorhanden.</p>
                        )}
                      </div>
                    )}

                    {action.type === 'notify' && (
                      <div className="space-y-1">
                        <FieldLabel>Nachricht</FieldLabel>
                        <TextInput value={action.notifyMessage}
                          onChange={(v) => patchAction(action.id, { notifyMessage: v })}
                          placeholder="z.B. Fenster ist seit 30 Minuten offen!" />
                        <p className="text-xs text-muted-foreground">
                          Wird im Dashboard als Benachrichtigung angezeigt (Phase 3).
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}

            {/* Vorschau */}
            {(() => {
              const hasConditions = form.conditions.length >= 1;
              const condText = describeConditions(buildConditions(form), devices);
              if (!condText) return null;
              if (form.kind === 'lock') {
                if (!form.blockDeviceId) return null;
                const lockAction = {
                  type: 'block_command',
                  device_id: Number(form.blockDeviceId),
                  status: form.blockStatus,
                };
                return (
                  <div className="rounded-md bg-muted px-4 py-3 text-sm space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vorschau</p>
                    <p><span className="text-muted-foreground">Wenn: </span>{condText}</p>
                    <p><span className="text-muted-foreground">Dann darf nicht: </span>
                      <span className="font-medium">{describeAction(lockAction, devices, rooms, scenes)}</span>
                    </p>
                  </div>
                );
              }
              const hasAction = form.actions.length >= 1 && form.actions.every(actionIsComplete);
              if (!hasConditions || !hasAction) return null;
              return (
                <div className="rounded-md bg-muted px-4 py-3 text-sm space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vorschau</p>
                  <p><span className="text-muted-foreground">Wenn: </span>{condText}</p>
                  <p><span className="text-muted-foreground">Dann: </span>
                    <span className="font-medium">{describeAction(buildAction(form), devices, rooms, scenes)}</span>
                  </p>
                </div>
              );
            })()}

            {dialog.error && <p className="text-sm text-destructive">{dialog.error}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog({ open: false, form: emptyForm(), saving: false, error: '' })}>
              Abbrechen
            </Button>
            <Button onClick={save} disabled={dialog.saving}>
              {dialog.saving ? 'Speichern...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loeschen bestaetigen */}
      <Dialog open={!!deleteConfirm?.open} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Automation loeschen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            <span className="font-medium text-foreground">{deleteConfirm?.name}</span> wird dauerhaft geloescht.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteAutomation(deleteConfirm.id)}>
              Loeschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
