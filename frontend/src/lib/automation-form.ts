import { Automation, Device, Room, Scene } from '@/lib/api';

export type ActionType =
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
  | 'thermostat_boost'
  | 'thermostat_timer'
  | 'thermostat_clear_boost'
  | 'activate_scene'
  | 'notify';

export type DeviceStatus = 'on' | 'off';
export type ActionDeviceStatus = 'on' | 'off' | 'open' | 'close' | 'stop';
export type ThermostatMode = 'heat' | 'off' | 'auto';
export type ConditionLogic = 'and' | 'or';
export type ConditionType =
  | 'device_status'
  | 'temperature_above'
  | 'temperature_below'
  | 'humidity_above'
  | 'humidity_below'
  | 'power_above'
  | 'power_below'
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

export const SWITCHABLE_TYPES = ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan', 'cover', 'valve', 'other', 'computer'];

export interface ConditionFormItem {
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

export interface ActionFormItem {
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
  boostDuration: string;
  timerDuration: string;
  timerTemp: string;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const newCondition = (): ConditionFormItem => ({
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

export const newAction = (): ActionFormItem => ({
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
  boostDuration: '30',
  timerDuration: '60',
  timerTemp: '21',
});

// ── Form-State ────────────────────────────────────────────────────────────────

export interface FormState {
  name: string;
  kind: 'automation' | 'lock';
  conditionLogic: ConditionLogic;
  conditions: ConditionFormItem[];
  actions: ActionFormItem[];
  blockDeviceId: string;
  blockStatus: ActionDeviceStatus | 'heat';
  retryIfBlocked: boolean;
}

export const emptyForm = (): FormState => ({
  name: '',
  kind: 'automation',
  conditionLogic: 'and',
  conditions: [],
  actions: [],
  blockDeviceId: '',
  blockStatus: 'off',
  retryIfBlocked: false,
});

export function conditionFromJson(item: Record<string, unknown>): ConditionFormItem {
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

export function actionFromJson(ac: Record<string, unknown>): ActionFormItem {
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
    thermostatMode: ac.mode === 'off' ? 'off' : 'heat',
    sceneId: ac.scene_id != null ? String(ac.scene_id) : '',
    childLock: ac.locked != null ? Boolean(ac.locked) : true,
    openWindow: ac.enabled != null ? Boolean(ac.enabled) : true,
    calibration: ac.type === 'set_thermostat_calibration' && ac.value != null
      ? String(ac.value)
      : '0',
    frostProtection: ac.type === 'set_thermostat_frost_protection' && ac.value != null
      ? String(ac.value)
      : '5',
    boostDuration: ac.duration != null ? String(ac.duration) : '30',
    timerDuration: ac.duration != null ? String(ac.duration) : '60',
    timerTemp: ac.temperature != null ? String(ac.temperature) : '21',
  };
}

/** Map classic triggers to conditions when automation has no conditions yet. */
export function conditionsFromLegacyTrigger(t: Record<string, unknown>): ConditionFormItem[] {
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

export function automationToForm(a: Automation): FormState {
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
    retryIfBlocked: Boolean(a.retry_if_blocked),
  };
}

export function nextCopyName(name: string, existing: string[]): string {
  const stripped = name.replace(/\s*\(Kopie(?: \d+)?\)\s*$/i, '').trim() || name;
  const taken = new Set(existing);
  let candidate = `${stripped} (Kopie)`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${stripped} (Kopie ${n})`;
    n += 1;
  }
  return candidate;
}

// ── Aktion / Bedingungen → JSON ───────────────────────────────────────────────

export function buildActionItem(a: ActionFormItem): Record<string, unknown> {
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
    case 'thermostat_boost':
      return { type: 'thermostat_boost', device_id: Number(a.deviceId), duration: Number(a.boostDuration) };
    case 'thermostat_timer':
      return {
        type: 'thermostat_timer',
        device_id: Number(a.deviceId),
        duration: Number(a.timerDuration),
        temperature: Number(a.timerTemp),
      };
    case 'thermostat_clear_boost':
      return { type: 'thermostat_clear_boost', device_id: Number(a.deviceId) };
    case 'activate_scene':
      return { type: 'activate_scene', scene_id: Number(a.sceneId) };
    case 'notify':
      return { type: 'notify', message: a.notifyMessage };
  }
}

export function buildAction(f: FormState): Record<string, unknown> {
  if (f.actions.length === 1) return buildActionItem(f.actions[0]);
  return { type: 'multi', actions: f.actions.map(buildActionItem) };
}

export function buildConditions(f: FormState): { logic: ConditionLogic; items: Record<string, unknown>[] } {
  const items = f.conditions.map((c) => {
    switch (c.type) {
      case 'device_status':
        return { type: 'device_status', device_id: Number(c.deviceId), status: c.status };
      case 'temperature_above':
      case 'temperature_below':
      case 'humidity_above':
      case 'humidity_below':
      case 'power_above':
      case 'power_below':
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

export const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function formatDeDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function statusActionLabel(status: unknown): string {
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

export function describeConditionItem(item: Record<string, unknown>, devices: Device[]): string {
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
    case 'power_above':
      return `Leistung (${dev(item.device_id)}) > ${item.threshold} W`;
    case 'power_below':
      return `Leistung (${dev(item.device_id)}) < ${item.threshold} W`;
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

export function describeConditions(
  conditions: { logic?: string; items?: Record<string, unknown>[] } | null | undefined,
  devices: Device[],
): string | null {
  const items = conditions?.items ?? [];
  if (items.length === 0) return null;
  const joiner = conditions?.logic === 'or' ? ' ODER ' : ' UND ';
  return items.map((item) => describeConditionItem(item, devices)).join(joiner);
}

export function describeTrigger(trigger: Record<string, unknown>, devices: Device[]): string {
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

export function describeActionItem(
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
        action.mode === 'off' ? 'Aus' : 'An';
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
    case 'thermostat_boost':
      return `"${dev(action.device_id)}" Boost ${action.duration} Min.`;
    case 'thermostat_timer':
      return `"${dev(action.device_id)}" Timer ${action.duration} Min. auf ${action.temperature}°C`;
    case 'thermostat_clear_boost':
      return `"${dev(action.device_id)}" Boost/Timer beenden`;
    case 'activate_scene':
      return `Szene "${scene(action.scene_id)}" aktivieren`;
    case 'notify':
      return `Benachrichtigung: "${action.message}"`;
    default:
      return 'Unbekannt';
  }
}

export function describeAction(
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

export function unwrapActions(action: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!action) return [];
  if (action.type === 'multi' && Array.isArray(action.actions)) {
    return action.actions as Record<string, unknown>[];
  }
  return [action];
}

export function collectDeviceIds(a: Automation): number[] {
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

export function collectDirectRoomIds(a: Automation): number[] {
  const ids = new Set<number>();
  for (const ac of unwrapActions(a.action)) {
    if (ac.type === 'set_room_devices' && ac.room_id != null) {
      const n = Number(ac.room_id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }
  return [...ids];
}

export function roomIdsForAutomation(a: Automation, devices: Device[]): number[] {
  const fromDevices = collectDeviceIds(a)
    .map((id) => devices.find((d) => d.id === id)?.room_id)
    .filter((id): id is number => typeof id === 'number' && id > 0);
  return [...new Set([...fromDevices, ...collectDirectRoomIds(a)])];
}

export type RoomGroupItem = { automation: Automation; otherRoomNames: string[] };
export type RoomGroup = { key: string; room: Room | null; items: RoomGroupItem[] };

export function groupAutomationsByRoom(
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
export const SCENE_ACTION_TYPES: ActionType[] = [
  'set_device_status',
  'toggle_device',
  'set_thermostat_setpoint',
  'set_thermostat_mode',
  'set_thermostat_child_lock',
  'set_thermostat_open_window',
  'set_thermostat_calibration',
  'set_thermostat_frost_protection',
];

export function conditionOfType(type: ConditionType): ConditionFormItem {
  const patch: Partial<ConditionFormItem> = { type, deviceId: '' };
  if (type === 'temperature_above' || type === 'temperature_below') patch.threshold = '22';
  if (type === 'humidity_above' || type === 'humidity_below') patch.threshold = '70';
  if (type === 'power_above') patch.threshold = '20';
  if (type === 'power_below') patch.threshold = '5';
  if (type === 'time_at') patch.time = '08:00';
  if (type === 'sunrise' || type === 'sunset') patch.offsetMinutes = '0';
  if (type === 'child_lock') patch.value = 'LOCK';
  if (type === 'open_window') patch.value = 'ON';
  return { ...newCondition(), ...patch };
}

export function actionOfType(type: ActionType): ActionFormItem {
  return { ...newAction(), type };
}

export function actionIsComplete(a: ActionFormItem): boolean {
  if (['set_device_status', 'toggle_device', 'delayed_off', 'delayed_on',
    'set_thermostat_setpoint', 'set_thermostat_mode',
    'set_thermostat_child_lock', 'set_thermostat_open_window',
    'set_thermostat_calibration', 'set_thermostat_frost_protection',
    'thermostat_boost', 'thermostat_timer', 'thermostat_clear_boost',
  ].includes(a.type) && !!a.deviceId) return true;
  if (a.type === 'set_room_devices' && !!a.roomId) return true;
  if (a.type === 'activate_scene' && !!a.sceneId) return true;
  if (a.type === 'notify' && !!a.notifyMessage.trim()) return true;
  return false;
}
