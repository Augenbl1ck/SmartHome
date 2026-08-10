'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { api, Automation, AutomationLog, Device, Room } from '@/lib/api';
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
  Pencil, Plus, Trash2, Clock, Zap, ChevronRight,
  Thermometer, Droplets, Activity, DoorOpen, Timer, History,
  Waves, Flame, Battery, Gauge,
} from 'lucide-react';
import { getEcho } from '@/lib/echo';

// ── Trigger-Typen ─────────────────────────────────────────────────────────────

type TriggerType =
  | 'time'
  | 'weekday_time'
  | 'device_status'
  | 'temperature_above'
  | 'temperature_below'
  | 'humidity_above'
  | 'humidity_below'
  | 'motion'
  | 'door_open'
  | 'door_closed'
  | 'device_on_duration'
  | 'flood'
  | 'smoke'
  | 'battery_low'
  | 'power_above';

// ── Aktions-Typen ─────────────────────────────────────────────────────────────

type ActionType =
  | 'set_device_status'
  | 'toggle_device'
  | 'set_room_devices'
  | 'delayed_off'
  | 'delayed_on'
  | 'set_thermostat_setpoint'
  | 'set_thermostat_mode'
  | 'notify';

type DeviceStatus = 'on' | 'off';
type ActionDeviceStatus = 'on' | 'off' | 'open' | 'close' | 'stop';
type ThermostatMode = 'heat' | 'off' | 'auto';

const SWITCHABLE_TYPES = ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan', 'cover', 'valve', 'other'];

// ── Form-State ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  triggerType: TriggerType;
  triggerTime: string;
  triggerWeekdays: number[];
  triggerDeviceId: string;
  triggerDeviceStatus: DeviceStatus;
  triggerSensorId: string;
  triggerThreshold: string;
  triggerDurationMinutes: string;
  actionType: ActionType;
  actionDeviceId: string;
  actionDeviceStatus: ActionDeviceStatus;
  actionRoomId: string;
  actionRoomStatus: DeviceStatus;
  actionDelayMinutes: string;
  actionNotifyMessage: string;
  actionSetpoint: string;
  actionThermostatMode: ThermostatMode;
}

const emptyForm = (): FormState => ({
  name: '',
  triggerType: 'time',
  triggerTime: '08:00',
  triggerWeekdays: [1, 2, 3, 4, 5],
  triggerDeviceId: '',
  triggerDeviceStatus: 'on',
  triggerSensorId: '',
  triggerThreshold: '25',
  triggerDurationMinutes: '30',
  actionType: 'set_device_status',
  actionDeviceId: '',
  actionDeviceStatus: 'on',
  actionRoomId: '',
  actionRoomStatus: 'off',
  actionDelayMinutes: '10',
  actionNotifyMessage: '',
  actionSetpoint: '21',
  actionThermostatMode: 'heat',
});

function automationToForm(a: Automation): FormState {
  const t = a.trigger as Record<string, unknown>;
  const ac = a.action as Record<string, unknown>;
  const defaultThreshold =
    t.type === 'battery_low' ? '20' : t.type === 'power_above' ? '100' : '25';
  return {
    name: a.name,
    triggerType: (t.type as TriggerType) ?? 'time',
    triggerTime: (t.time as string) ?? '08:00',
    triggerWeekdays: (t.weekdays as number[]) ?? [1, 2, 3, 4, 5],
    triggerDeviceId: t.device_id != null ? String(t.device_id) : '',
    triggerDeviceStatus: (t.status as DeviceStatus) ?? 'on',
    triggerSensorId: t.device_id != null ? String(t.device_id) : '',
    triggerThreshold: t.threshold != null ? String(t.threshold) : defaultThreshold,
    triggerDurationMinutes: t.minutes != null ? String(t.minutes) : '30',
    actionType: (ac.type as ActionType) ?? 'set_device_status',
    actionDeviceId: ac.device_id != null ? String(ac.device_id) : '',
    actionDeviceStatus: (ac.status as ActionDeviceStatus) ?? 'on',
    actionRoomId: ac.room_id != null ? String(ac.room_id) : '',
    actionRoomStatus: (ac.status as DeviceStatus) ?? 'off',
    actionDelayMinutes: ac.minutes != null ? String(ac.minutes) : '10',
    actionNotifyMessage: (ac.message as string) ?? '',
    actionSetpoint: ac.setpoint != null ? String(ac.setpoint) : '21',
    actionThermostatMode: (ac.mode as ThermostatMode) ?? 'heat',
  };
}

// ── Trigger/Aktion → JSON ─────────────────────────────────────────────────────

function buildTrigger(f: FormState): Record<string, unknown> {
  switch (f.triggerType) {
    case 'time':
      return { type: 'time', time: f.triggerTime };
    case 'weekday_time':
      return { type: 'weekday_time', time: f.triggerTime, weekdays: f.triggerWeekdays };
    case 'device_status':
      return { type: 'device_status', device_id: Number(f.triggerDeviceId), status: f.triggerDeviceStatus };
    case 'temperature_above':
      return { type: 'temperature_above', device_id: Number(f.triggerSensorId), threshold: Number(f.triggerThreshold) };
    case 'temperature_below':
      return { type: 'temperature_below', device_id: Number(f.triggerSensorId), threshold: Number(f.triggerThreshold) };
    case 'humidity_above':
      return { type: 'humidity_above', device_id: Number(f.triggerSensorId), threshold: Number(f.triggerThreshold) };
    case 'humidity_below':
      return { type: 'humidity_below', device_id: Number(f.triggerSensorId), threshold: Number(f.triggerThreshold) };
    case 'motion':
      return { type: 'motion', device_id: Number(f.triggerDeviceId) };
    case 'door_open':
      return { type: 'door_open', device_id: Number(f.triggerDeviceId) };
    case 'door_closed':
      return { type: 'door_closed', device_id: Number(f.triggerDeviceId) };
    case 'device_on_duration':
      return { type: 'device_on_duration', device_id: Number(f.triggerDeviceId), minutes: Number(f.triggerDurationMinutes) };
    case 'flood':
      return { type: 'flood', device_id: Number(f.triggerDeviceId) };
    case 'smoke':
      return { type: 'smoke', device_id: Number(f.triggerDeviceId) };
    case 'battery_low':
      return { type: 'battery_low', device_id: Number(f.triggerDeviceId), threshold: Number(f.triggerThreshold) };
    case 'power_above':
      return { type: 'power_above', device_id: Number(f.triggerDeviceId), threshold: Number(f.triggerThreshold) };
  }
}

function buildAction(f: FormState): Record<string, unknown> {
  switch (f.actionType) {
    case 'set_device_status':
      return { type: 'set_device_status', device_id: Number(f.actionDeviceId), status: f.actionDeviceStatus };
    case 'toggle_device':
      return { type: 'toggle_device', device_id: Number(f.actionDeviceId) };
    case 'set_room_devices':
      return { type: 'set_room_devices', room_id: Number(f.actionRoomId), status: f.actionRoomStatus };
    case 'delayed_off':
      return { type: 'delayed_off', device_id: Number(f.actionDeviceId), minutes: Number(f.actionDelayMinutes) };
    case 'delayed_on':
      return { type: 'delayed_on', device_id: Number(f.actionDeviceId), minutes: Number(f.actionDelayMinutes) };
    case 'set_thermostat_setpoint':
      return { type: 'set_thermostat_setpoint', device_id: Number(f.actionDeviceId), setpoint: Number(f.actionSetpoint) };
    case 'set_thermostat_mode':
      return { type: 'set_thermostat_mode', device_id: Number(f.actionDeviceId), mode: f.actionThermostatMode };
    case 'notify':
      return { type: 'notify', message: f.actionNotifyMessage };
  }
}

// ── Menschenlesbare Texte ─────────────────────────────────────────────────────

const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function statusActionLabel(status: unknown): string {
  switch (status) {
    case 'on': return 'einschalten';
    case 'off': return 'ausschalten';
    case 'open': return 'oeffnen';
    case 'close': return 'schliessen';
    case 'stop': return 'stopp';
    default: return String(status ?? '');
  }
}

function describeTrigger(trigger: Record<string, unknown>, devices: Device[]): string {
  const dev = (id: unknown) => devices.find((d) => d.id === Number(id))?.name ?? '?';
  switch (trigger.type) {
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

function describeAction(action: Record<string, unknown>, devices: Device[], rooms: Room[]): string {
  const dev = (id: unknown) => devices.find((d) => d.id === Number(id))?.name ?? '?';
  const room = (id: unknown) => rooms.find((r) => r.id === Number(id))?.name ?? '?';
  switch (action.type) {
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
    case 'notify':
      return `Benachrichtigung: "${action.message}"`;
    default:
      return 'Unbekannt';
  }
}

function getTriggerIcon(type: string) {
  if (type === 'time' || type === 'weekday_time') return Clock;
  if (type === 'temperature_above' || type === 'temperature_below') return Thermometer;
  if (type === 'humidity_above' || type === 'humidity_below') return Droplets;
  if (type === 'motion') return Activity;
  if (type === 'door_open' || type === 'door_closed') return DoorOpen;
  if (type === 'device_on_duration') return Timer;
  if (type === 'flood') return Waves;
  if (type === 'smoke') return Flame;
  if (type === 'battery_low') return Battery;
  if (type === 'power_above') return Gauge;
  return Zap;
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
  initialLogs: AutomationLog[];
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function AutomationsClient({ initialAutomations, devices, rooms, initialLogs }: Props) {
  const [automations, setAutomations] = useState(initialAutomations);
  const [logs, setLogs]               = useState<AutomationLog[]>(initialLogs);
  const [activeTab, setActiveTab]     = useState<'automations' | 'history'>('automations');

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
    const needsDevice: TriggerType[] = [
      'device_status', 'motion', 'door_open', 'door_closed', 'device_on_duration',
      'flood', 'smoke', 'battery_low', 'power_above',
    ];
    if (needsDevice.includes(f.triggerType) && !f.triggerDeviceId)
      return 'Bitte ein Geraet fuer den Ausloser waehlen.';
    const needsSensor: TriggerType[] = ['temperature_above', 'temperature_below', 'humidity_above', 'humidity_below'];
    if (needsSensor.includes(f.triggerType) && !f.triggerSensorId)
      return 'Bitte einen Sensor waehlen.';
    if (f.triggerType === 'weekday_time' && f.triggerWeekdays.length === 0)
      return 'Bitte mindestens einen Wochentag waehlen.';
    if (f.actionType === 'set_room_devices' && !f.actionRoomId)
      return 'Bitte einen Raum fuer die Aktion waehlen.';
    const needsActionDevice: ActionType[] = [
      'set_device_status', 'toggle_device', 'delayed_off', 'delayed_on',
      'set_thermostat_setpoint', 'set_thermostat_mode',
    ];
    if (needsActionDevice.includes(f.actionType) && !f.actionDeviceId)
      return 'Bitte ein Ziel-Geraet fuer die Aktion waehlen.';
    if (f.actionType === 'set_thermostat_setpoint') {
      const sp = Number(f.actionSetpoint);
      if (Number.isNaN(sp) || sp < 4 || sp > 35)
        return 'Sollwert muss zwischen 4 und 35°C liegen.';
    }
    if (f.actionType === 'notify' && !f.actionNotifyMessage.trim())
      return 'Bitte eine Benachrichtigungs-Nachricht eingeben.';
    return '';
  };

  const save = async () => {
    const { form, editing } = dialog;
    const err = validate(form);
    if (err) { setDialog((s) => ({ ...s, error: err })); return; }
    setDialog((s) => ({ ...s, saving: true, error: '' }));
    try {
      const payload = { name: form.name.trim(), trigger: buildTrigger(form), action: buildAction(form) };
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
  const humiditySensors = devices.filter((d) => d.type === 'sensor_humidity');
  const motionSensors = devices.filter((d) => d.type === 'sensor_motion');
  const doorSensors = devices.filter((d) => d.type === 'sensor_door');
  const floodSensors = devices.filter((d) => d.type === 'sensor_flood');
  const smokeSensors = devices.filter((d) => d.type === 'sensor_smoke');
  const powerDevices = devices.filter((d) => ['plug', 'switch', 'light', 'other'].includes(d.type));
  const thermostats = devices.filter((d) => d.type === 'thermostat');
  const switchableDevices = devices.filter((d) => SWITCHABLE_TYPES.includes(d.type));

  const { form } = dialog;
  const actionTargetDevice = switchableDevices.find((d) => String(d.id) === form.actionDeviceId);
  const actionTargetIsCover = actionTargetDevice?.type === 'cover';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Automationen</h1>
        {activeTab === 'automations' && (
          <Button size="sm" onClick={() => setDialog({ open: true, form: emptyForm(), saving: false, error: '' })}>
            <Plus className="h-4 w-4 mr-1" /> Neue Automation
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
            {automations.length}
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

      {/* ── Verlauf-Tab ────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-2">
          {logs.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Noch keine Automationen ausgeführt.
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
      {activeTab === 'automations' && (<>

      {automations.length === 0 && (
        <p className="text-muted-foreground text-sm">Noch keine Automationen vorhanden.</p>
      )}

      <div className="space-y-3">
        {automations.map((automation) => {
          const trigger = automation.trigger as Record<string, unknown>;
          const action = automation.action as Record<string, unknown>;
          const TriggerIcon = getTriggerIcon(trigger.type as string);
          return (
            <Card key={automation.id} className={!automation.enabled ? 'opacity-60' : ''}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CardTitle className="text-base truncate">{automation.name}</CardTitle>
                  {!automation.enabled && (
                    <Badge variant="secondary" className="text-xs shrink-0">Deaktiviert</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <Switch checked={automation.enabled} onCheckedChange={() => handleToggle(automation)} />
                  <Button variant="ghost" size="icon" onClick={() =>
                    setDialog({ open: true, editing: automation, form: automationToForm(automation), saving: false, error: '' })
                  }>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirm({ open: true, id: automation.id, name: automation.name })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <TriggerIcon className="h-3.5 w-3.5 shrink-0" />
                    {describeTrigger(trigger, devices)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{describeAction(action, devices, rooms)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Automations-Dialog ─────────────────────────────────────────── */}
      <Dialog open={dialog.open} onOpenChange={(open) =>
        !open && setDialog({ open: false, form: emptyForm(), saving: false, error: '' })
      }>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.editing ? 'Automation bearbeiten' : 'Neue Automation'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name */}
            <div className="space-y-1">
              <FieldLabel>Name</FieldLabel>
              <TextInput value={form.name} onChange={(v) => patchForm({ name: v })} placeholder="z.B. Nachtmodus" />
            </div>

            {/* AUSLOSER */}
            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Zap className="h-4 w-4" /> Wenn ... (Ausloser)
              </p>

              <div className="space-y-1">
                <FieldLabel>Ausloser-Typ</FieldLabel>
                <Select value={form.triggerType} onValueChange={(v) => {
                  const type = v as TriggerType;
                  const patch: Partial<FormState> = { triggerType: type };
                  if (type === 'battery_low') patch.triggerThreshold = '20';
                  else if (type === 'power_above') patch.triggerThreshold = '100';
                  else if (type === 'temperature_above' || type === 'temperature_below') patch.triggerThreshold = '25';
                  else if (type === 'humidity_above' || type === 'humidity_below') patch.triggerThreshold = '70';
                  patchForm(patch);
                }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Zeit</SelectLabel>
                      <SelectItem value="time">Uhrzeit - taeglich</SelectItem>
                      <SelectItem value="weekday_time">Uhrzeit - bestimmte Wochentage</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Geraet</SelectLabel>
                      <SelectItem value="device_status">Geraet wird ein-/ausgeschaltet</SelectItem>
                      <SelectItem value="device_on_duration">Geraet ist zu lange eingeschaltet</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Sensoren</SelectLabel>
                      <SelectItem value="temperature_above">Temperatur ueberschritten</SelectItem>
                      <SelectItem value="temperature_below">Temperatur unterschritten</SelectItem>
                      <SelectItem value="humidity_above">Luftfeuchtigkeit zu hoch</SelectItem>
                      <SelectItem value="humidity_below">Luftfeuchtigkeit zu niedrig</SelectItem>
                      <SelectItem value="motion">Bewegung erkannt</SelectItem>
                      <SelectItem value="door_open">Tuer / Fenster geoeffnet</SelectItem>
                      <SelectItem value="door_closed">Tuer / Fenster geschlossen</SelectItem>
                      <SelectItem value="flood">Wasseralarm</SelectItem>
                      <SelectItem value="smoke">Rauchalarm</SelectItem>
                      <SelectItem value="battery_low">Batterie niedrig</SelectItem>
                      <SelectItem value="power_above">Leistungsaufnahme zu hoch</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {(form.triggerType === 'time' || form.triggerType === 'weekday_time') && (
                <div className="space-y-1">
                  <FieldLabel>Uhrzeit</FieldLabel>
                  <input type="time"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.triggerTime} onChange={(e) => patchForm({ triggerTime: e.target.value })} />
                </div>
              )}

              {form.triggerType === 'weekday_time' && (
                <div className="space-y-1">
                  <FieldLabel>Wochentage</FieldLabel>
                  <WeekdayPicker value={form.triggerWeekdays} onChange={(v) => patchForm({ triggerWeekdays: v })} />
                </div>
              )}

              {form.triggerType === 'device_status' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Geraet</FieldLabel>
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={devices} rooms={rooms} />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Ereignis</FieldLabel>
                    <Select value={form.triggerDeviceStatus} onValueChange={(v) => patchForm({ triggerDeviceStatus: v as DeviceStatus })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">wird eingeschaltet</SelectItem>
                        <SelectItem value="off">wird ausgeschaltet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {form.triggerType === 'device_on_duration' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Geraet</FieldLabel>
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={switchableDevices} rooms={rooms} />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Laenger als (Minuten)</FieldLabel>
                    <TextInput type="number" value={form.triggerDurationMinutes}
                      onChange={(v) => patchForm({ triggerDurationMinutes: v })} placeholder="30" />
                  </div>
                </div>
              )}

              {(form.triggerType === 'temperature_above' || form.triggerType === 'temperature_below') && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Temperaturquelle</FieldLabel>
                    {tempSensors.length > 0 ? (
                      <DeviceSelect value={form.triggerSensorId} onChange={(v) => patchForm({ triggerSensorId: v })}
                        devices={tempSensors} rooms={rooms} />
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Keine Temperatursensoren oder Thermostate vorhanden.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Schwellwert (°C)</FieldLabel>
                    <TextInput type="number" value={form.triggerThreshold}
                      onChange={(v) => patchForm({ triggerThreshold: v })} placeholder="25" />
                  </div>
                </div>
              )}

              {(form.triggerType === 'humidity_above' || form.triggerType === 'humidity_below') && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Feuchtigkeitssensor</FieldLabel>
                    {humiditySensors.length > 0 ? (
                      <DeviceSelect value={form.triggerSensorId} onChange={(v) => patchForm({ triggerSensorId: v })}
                        devices={humiditySensors} rooms={rooms} />
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Keine Feuchtigkeitssensoren vorhanden.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Schwellwert (%)</FieldLabel>
                    <TextInput type="number" value={form.triggerThreshold}
                      onChange={(v) => patchForm({ triggerThreshold: v })} placeholder="70" />
                  </div>
                </div>
              )}

              {form.triggerType === 'motion' && (
                <div className="space-y-1">
                  <FieldLabel>Bewegungsmelder</FieldLabel>
                  {motionSensors.length > 0 ? (
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={motionSensors} rooms={rooms} />
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">Keine Bewegungsmelder vorhanden.</p>
                  )}
                </div>
              )}

              {(form.triggerType === 'door_open' || form.triggerType === 'door_closed') && (
                <div className="space-y-1">
                  <FieldLabel>Tuer-/Fenstersensor</FieldLabel>
                  {doorSensors.length > 0 ? (
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={doorSensors} rooms={rooms} />
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">Keine Tuer-/Fenstersensoren vorhanden.</p>
                  )}
                </div>
              )}

              {form.triggerType === 'flood' && (
                <div className="space-y-1">
                  <FieldLabel>Wassersensor</FieldLabel>
                  {floodSensors.length > 0 ? (
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={floodSensors} rooms={rooms} />
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">Keine Wassersensoren vorhanden.</p>
                  )}
                </div>
              )}

              {form.triggerType === 'smoke' && (
                <div className="space-y-1">
                  <FieldLabel>Rauchmelder</FieldLabel>
                  {smokeSensors.length > 0 ? (
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={smokeSensors} rooms={rooms} />
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">Keine Rauchmelder vorhanden.</p>
                  )}
                </div>
              )}

              {form.triggerType === 'battery_low' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Geraet</FieldLabel>
                    <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                      devices={devices} rooms={rooms} />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Unter (%)</FieldLabel>
                    <TextInput type="number" value={form.triggerThreshold}
                      onChange={(v) => patchForm({ triggerThreshold: v })} placeholder="20" />
                  </div>
                </div>
              )}

              {form.triggerType === 'power_above' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Geraet</FieldLabel>
                    {powerDevices.length > 0 ? (
                      <DeviceSelect value={form.triggerDeviceId} onChange={(v) => patchForm({ triggerDeviceId: v })}
                        devices={powerDevices} rooms={rooms} />
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Keine passenden Geraete vorhanden.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Schwellwert (W)</FieldLabel>
                    <TextInput type="number" value={form.triggerThreshold}
                      onChange={(v) => patchForm({ triggerThreshold: v })} placeholder="100" />
                  </div>
                </div>
              )}
            </div>

            {/* AKTION */}
            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <ChevronRight className="h-4 w-4" /> Dann ... (Aktion)
              </p>

              <div className="space-y-1">
                <FieldLabel>Aktions-Typ</FieldLabel>
                <Select value={form.actionType} onValueChange={(v) => patchForm({ actionType: v as ActionType })}>
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
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Raum steuern</SelectLabel>
                      <SelectItem value="set_room_devices">Alle Geraete im Raum ein-/ausschalten</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Sonstiges</SelectLabel>
                      <SelectItem value="notify">Benachrichtigung senden</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {form.actionType === 'set_device_status' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Geraet</FieldLabel>
                    <DeviceSelect
                      value={form.actionDeviceId}
                      onChange={(v) => {
                        const next = switchableDevices.find((d) => String(d.id) === v);
                        const patch: Partial<FormState> = { actionDeviceId: v };
                        if (next?.type === 'cover' && !['open', 'close', 'stop'].includes(form.actionDeviceStatus)) {
                          patch.actionDeviceStatus = 'open';
                        } else if (next && next.type !== 'cover' && ['open', 'close', 'stop'].includes(form.actionDeviceStatus)) {
                          patch.actionDeviceStatus = 'on';
                        }
                        patchForm(patch);
                      }}
                      devices={switchableDevices} rooms={rooms} />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Aktion</FieldLabel>
                    <Select value={form.actionDeviceStatus} onValueChange={(v) => patchForm({ actionDeviceStatus: v as ActionDeviceStatus })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {actionTargetIsCover ? (
                          <>
                            <SelectItem value="open">oeffnen</SelectItem>
                            <SelectItem value="close">schliessen</SelectItem>
                            <SelectItem value="stop">stopp</SelectItem>
                          </>
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

              {form.actionType === 'toggle_device' && (
                <div className="space-y-1">
                  <FieldLabel>Geraet</FieldLabel>
                  <DeviceSelect value={form.actionDeviceId} onChange={(v) => patchForm({ actionDeviceId: v })}
                    devices={switchableDevices} rooms={rooms} />
                </div>
              )}

              {(form.actionType === 'delayed_off' || form.actionType === 'delayed_on') && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Geraet</FieldLabel>
                    <DeviceSelect value={form.actionDeviceId} onChange={(v) => patchForm({ actionDeviceId: v })}
                      devices={switchableDevices} rooms={rooms} />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Verzoegerung (Minuten)</FieldLabel>
                    <TextInput type="number" value={form.actionDelayMinutes}
                      onChange={(v) => patchForm({ actionDelayMinutes: v })} placeholder="10" />
                  </div>
                </div>
              )}

              {form.actionType === 'set_room_devices' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Raum</FieldLabel>
                    <Select value={form.actionRoomId} onValueChange={(v) => patchForm({ actionRoomId: v })}>
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
                    <Select value={form.actionRoomStatus} onValueChange={(v) => patchForm({ actionRoomStatus: v as DeviceStatus })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">alle einschalten</SelectItem>
                        <SelectItem value="off">alle ausschalten</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {form.actionType === 'set_thermostat_setpoint' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Thermostat</FieldLabel>
                    {thermostats.length > 0 ? (
                      <DeviceSelect value={form.actionDeviceId} onChange={(v) => patchForm({ actionDeviceId: v })}
                        devices={thermostats} rooms={rooms} />
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Sollwert (°C)</FieldLabel>
                    <TextInput type="number" value={form.actionSetpoint}
                      onChange={(v) => patchForm({ actionSetpoint: v })} placeholder="21" />
                    <p className="text-xs text-muted-foreground">4–35°C, Schritte 0.5</p>
                  </div>
                </div>
              )}

              {form.actionType === 'set_thermostat_mode' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <FieldLabel>Thermostat</FieldLabel>
                    {thermostats.length > 0 ? (
                      <DeviceSelect value={form.actionDeviceId} onChange={(v) => patchForm({ actionDeviceId: v })}
                        devices={thermostats} rooms={rooms} />
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Modus</FieldLabel>
                    <Select value={form.actionThermostatMode} onValueChange={(v) => patchForm({ actionThermostatMode: v as ThermostatMode })}>
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

              {form.actionType === 'notify' && (
                <div className="space-y-1">
                  <FieldLabel>Nachricht</FieldLabel>
                  <TextInput value={form.actionNotifyMessage}
                    onChange={(v) => patchForm({ actionNotifyMessage: v })}
                    placeholder="z.B. Fenster ist seit 30 Minuten offen!" />
                  <p className="text-xs text-muted-foreground">
                    Wird im Dashboard als Benachrichtigung angezeigt (Phase 3).
                  </p>
                </div>
              )}
            </div>

            {/* Vorschau */}
            {(() => {
              const hasTrigger =
                form.triggerType === 'time' || form.triggerType === 'weekday_time' ||
                (['device_status', 'device_on_duration', 'motion', 'door_open', 'door_closed', 'flood', 'smoke', 'battery_low', 'power_above'].includes(form.triggerType) && !!form.triggerDeviceId) ||
                (['temperature_above', 'temperature_below', 'humidity_above', 'humidity_below'].includes(form.triggerType) && !!form.triggerSensorId);
              const hasAction =
                (['set_device_status', 'toggle_device', 'delayed_off', 'delayed_on', 'set_thermostat_setpoint', 'set_thermostat_mode'].includes(form.actionType) && !!form.actionDeviceId) ||
                (form.actionType === 'set_room_devices' && !!form.actionRoomId) ||
                (form.actionType === 'notify' && !!form.actionNotifyMessage.trim());
              if (!hasTrigger || !hasAction) return null;
              return (
                <div className="rounded-md bg-muted px-4 py-3 text-sm space-y-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vorschau</p>
                  <p><span className="text-muted-foreground">Wenn: </span>{describeTrigger(buildTrigger(form), devices)}</p>
                  <p><span className="text-muted-foreground">Dann: </span>
                    <span className="font-medium">{describeAction(buildAction(form), devices, rooms)}</span>
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
    </>)}
    </div>
  );
}
