'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { api, Automation, AutomationLog, Device, Room, Scene } from '@/lib/api';
import {
  ActionType, ConditionType, FormState, RoomGroup,
  automationToForm, buildAction, buildConditions, describeAction,
  describeConditions, describeTrigger, emptyForm, groupAutomationsByRoom, nextCopyName,
} from '@/lib/automation-form';
import AutomationEditor from '@/components/automation/AutomationEditor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Pencil, Plus, Trash2, Copy, Clock, Zap, ChevronRight, ArrowLeft,
  Thermometer, Droplets, Activity, DoorOpen, Timer, History,
  Waves, Flame, Battery, Gauge, Filter, Shield,
  List, LayoutGrid,
} from 'lucide-react';
import { getEcho, onEchoReset } from '@/lib/echo';
import { isInterlockAutomation } from '@/lib/devices';
import { useSmartHomeStore } from '@/store/smarthome';

function AutomationCard({
  automation,
  devices,
  rooms,
  scenes,
  extraBadge,
  isLock = false,
  onToggle,
  onEdit,
  onDuplicate,
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
  onDuplicate: (a: Automation) => void;
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
          {automation.retry_if_blocked && !isLock && (
            <Badge variant="outline" className="text-xs shrink-0">Bei Sperre alle 5 Min.</Badge>
          )}
          {extraBadge && (
            <Badge variant="outline" className="text-xs shrink-0 max-w-[14rem] truncate" title={extraBadge}>
              {extraBadge}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <Switch checked={automation.enabled} onCheckedChange={() => onToggle(automation)} />
          <Button type="button" variant="ghost" size="icon" aria-label="Bearbeiten" onClick={() => onEdit(automation)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Duplizieren"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDuplicate(automation)}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label="Löschen"
            onPointerDown={(e) => e.stopPropagation()}
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
  onDuplicate,
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
  onDuplicate: (a: Automation) => void;
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
      onDuplicate={onDuplicate}
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
  if (type === 'power_above' || type === 'power_below') return Gauge;
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
  const [toggleError, setToggleError] = useState('');
  const [activeTab, setActiveTab]     = useState<'automations' | 'locks' | 'history'>('automations');
  const [listView, setListView]       = useState<'flat' | 'byRoom'>('flat');

  const [dialog, setDialog] = useState<{
    open: boolean;
    editing?: Automation;
    duplicating?: boolean;
    form: FormState;
    saving: boolean;
    error: string;
  }>({ open: false, form: emptyForm(), saving: false, error: '' });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    id: number;
    name: string;
    error?: string;
  } | null>(null);

  const patchForm = (patch: Partial<FormState>) =>
    setDialog((s) => ({ ...s, form: { ...s.form, ...patch } }));

  useEffect(() => {
    let cancelled = false;
    api.getAutomations()
      .then((fresh) => { if (!cancelled) setAutomations(fresh); })
      .catch(() => { /* SSR-Stand behalten */ });
    return () => { cancelled = true; };
  }, []);

  // Echtzeit-Updates: neuer Log-Eintrag wenn Automation feuert
  useEffect(() => {
    let echo: ReturnType<typeof getEcho> | null = null;
    const bindEcho = () => {
      try { echo?.leaveChannel('automations'); } catch { /* alte Verbindung */ }
      echo = null;
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
      } catch { echo = null; }
    };
    bindEcho();
    const offEcho = onEchoReset(bindEcho);
    return () => {
      offEcho();
      if (echo) echo.leaveChannel('automations');
    };
  }, []);

  const handleToggle = async (automation: Automation) => {
    setToggleError('');
    try {
      const updated = await api.updateAutomation(automation.id, { enabled: !automation.enabled });
      setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : 'Änderung konnte nicht gespeichert werden');
    }
  };

  const openDuplicate = (a: Automation) => {
    const form = automationToForm(a);
    form.name = nextCopyName(a.name, automations.map((x) => x.name));
    setDialog({ open: true, duplicating: true, form, saving: false, error: '' });
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
        'humidity_above', 'humidity_below', 'power_above', 'power_below', 'door_open', 'door_closed', 'motion',
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
      if ((c.type === 'power_above' || c.type === 'power_below') && !Number.isFinite(Number(c.threshold)))
        return `${label}: bitte eine Leistung in Watt angeben.`;
      if ((c.type === 'child_lock' || c.type === 'open_window') && !c.value)
        return `${label}: bitte einen Wert waehlen.`;
    }

    const needsActionDevice: ActionType[] = [
      'set_device_status', 'toggle_device', 'delayed_off', 'delayed_on',
      'set_thermostat_setpoint', 'set_thermostat_mode',
      'set_thermostat_child_lock', 'set_thermostat_open_window',
      'set_thermostat_calibration', 'set_thermostat_frost_protection',
      'thermostat_boost', 'thermostat_timer', 'thermostat_clear_boost',
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
      if (a.type === 'thermostat_boost') {
        const d = Number(a.boostDuration);
        if (Number.isNaN(d) || d < 1 || d > 180)
          return `${label}: Boost-Dauer muss zwischen 1 und 180 Minuten liegen.`;
      }
      if (a.type === 'thermostat_timer') {
        const d = Number(a.timerDuration);
        const t = Number(a.timerTemp);
        if (Number.isNaN(d) || d < 1 || d > 1440)
          return `${label}: Timer-Dauer muss zwischen 1 und 1440 Minuten liegen.`;
        if (Number.isNaN(t) || t < 4 || t > 35)
          return `${label}: Timer-Temperatur muss zwischen 4 und 35°C liegen.`;
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
            retry_if_blocked: form.retryIfBlocked,
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
    try {
      await api.deleteAutomation(id);
      setAutomations((prev) => prev.filter((a) => a.id !== id));
      setDeleteConfirm(null);
    } catch {
      setDeleteConfirm((s) => (s ? { ...s, error: 'Löschen fehlgeschlagen.' } : s));
    }
  };

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
  const { form } = dialog;

  if (dialog.open) {
    const title = form.kind === 'lock'
      ? (dialog.editing ? 'Sperre bearbeiten' : dialog.duplicating ? 'Sperre duplizieren' : 'Neue Sperre')
      : (dialog.editing ? 'Automation bearbeiten' : dialog.duplicating ? 'Automation duplizieren' : 'Neue Automation');
    return (
      <AutomationEditor
        title={title}
        form={form}
        devices={devices}
        rooms={rooms}
        scenes={scenes}
        saving={dialog.saving}
        error={dialog.error}
        onChange={patchForm}
        onClose={() => setDialog({ open: false, form: emptyForm(), saving: false, error: '' })}
        onSave={() => { void save(); }}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-3xl xl:max-w-5xl">
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
        {toggleError && (
          <p className="text-sm text-destructive max-w-[16rem] text-right">{toggleError}</p>
        )}
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
          onDuplicate={openDuplicate}
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
          onDuplicate={openDuplicate}
          onDelete={(a) => setDeleteConfirm({ open: true, id: a.id, name: a.name })}
        />
      )}

      {/* Löschen bestätigen */}
      <Dialog open={!!deleteConfirm?.open} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Automation löschen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            <span className="font-medium text-foreground">{deleteConfirm?.name}</span> wird dauerhaft gelöscht.
          </p>
          {deleteConfirm?.error && (
            <p className="text-sm text-destructive">{deleteConfirm.error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
            <Button
              type="button"
              variant="destructive"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                const id = deleteConfirm?.id;
                if (id != null) void deleteAutomation(id);
              }}
            >
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
