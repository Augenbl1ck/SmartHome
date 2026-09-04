'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Device, Scene, DeviceType } from '@/lib/api';
import { cn } from '@/lib/utils';
import { deviceLabels } from '@/lib/devices';
import { Plus, Pencil, Trash2, Play, RotateCcw, AlertCircle, ArrowLeft, ChevronUp, ChevronDown, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { shellyBle } from '@/lib/bluetooth';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { useSmartHomeStore } from '@/store/smarthome';
import SceneDelayDialog, { formatDelayMinutes } from '@/components/SceneDelayDialog';
import { toast } from 'sonner';

const SCENE_ICONS = ['🎬', '💡', '🌙', '☀️', '🎵', '🍿', '🏠', '😴', '🚗', '🌿', '🎮', '📖'];
const SNAPSHOTS_KEY = 'smarthome_scene_snapshots';
const SWITCHABLE_TYPES = ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan', 'cover', 'valve', 'other', 'computer'];

type DeviceSnapshot = { device_id: number; status: 'on' | 'off' };
type Snapshots = Record<number, DeviceSnapshot[]>;

type SceneActionType =
  | 'set_device_status'
  | 'toggle_device'
  | 'set_thermostat_setpoint'
  | 'set_thermostat_mode'
  | 'set_thermostat_child_lock'
  | 'set_thermostat_open_window'
  | 'set_thermostat_calibration'
  | 'set_thermostat_frost_protection';

type ActionDeviceStatus = 'on' | 'off' | 'open' | 'close' | 'stop';
type ThermostatMode = 'heat' | 'off' | 'auto';

interface SceneActionForm {
  id: string;
  type: SceneActionType;
  deviceId: string;
  deviceStatus: ActionDeviceStatus;
  setpoint: string;
  thermostatMode: ThermostatMode;
  childLock: boolean;
  openWindow: boolean;
  calibration: string;
  frostProtection: string;
}

interface Props { initialScenes: Scene[]; devices: Device[] }
interface SceneForm { name: string; icon: string; actions: SceneActionForm[] }

const emptyForm = (): SceneForm => ({ name: '', icon: '🎬', actions: [] });

const newAction = (devices: Device[]): SceneActionForm => {
  const switchable = devices.filter((d) => SWITCHABLE_TYPES.includes(d.type));
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'set_device_status',
    deviceId: switchable[0] ? String(switchable[0].id) : '',
    deviceStatus: 'on',
    setpoint: '21',
    thermostatMode: 'heat',
    childLock: true,
    openWindow: true,
    calibration: '0',
    frostProtection: '5',
  };
};

function isBle(device: Device) {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

function isOnOffAction(a: Record<string, unknown>): boolean {
  const type = String(a.type ?? '');
  if (type === 'toggle_device') return true;
  if (type === 'set_device_status') {
    const s = String(a.status ?? '');
    return s === 'on' || s === 'off';
  }
  // Legacy
  if (!type && a.device_id != null) {
    const s = String(a.status ?? '');
    return s === 'on' || s === 'off' || s === 'toggle';
  }
  return false;
}

function actionDeviceId(a: Record<string, unknown>): number | null {
  if (a.device_id != null) return Number(a.device_id);
  return null;
}

function loadSnapshots(): Snapshots {
  try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) ?? '{}'); } catch { return {}; }
}
function cacheSnapshots(s: Snapshots) {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(s));
}
async function saveSnapshots(s: Snapshots) {
  cacheSnapshots(s);
  try {
    await api.updatePanelSettings({ scene_snapshots: s });
  } catch { /* */ }
}
async function syncSnapshotsFromServer(): Promise<Snapshots> {
  const local = loadSnapshots();
  try {
    const res = await api.getPanelSettings();
    if (res.scene_snapshots && typeof res.scene_snapshots === 'object') {
      const remote = res.scene_snapshots as Snapshots;
      cacheSnapshots(remote);
      return remote;
    }
    if (Object.keys(local).length > 0) {
      await api.updatePanelSettings({ scene_snapshots: local });
    }
  } catch { /* */ }
  return local;
}

function actionFromStored(a: Record<string, unknown>): SceneActionForm {
  const base = newAction([]);
  // Legacy
  if (!a.type || a.type === '') {
    const status = String(a.status ?? 'on');
    if (status === 'toggle') {
      return { ...base, type: 'toggle_device', deviceId: a.device_id != null ? String(a.device_id) : '' };
    }
    return {
      ...base,
      type: 'set_device_status',
      deviceId: a.device_id != null ? String(a.device_id) : '',
      deviceStatus: (['open', 'close', 'stop', 'on', 'off'].includes(status)
        ? status
        : 'on') as ActionDeviceStatus,
    };
  }

  const type = a.type as SceneActionType;
  return {
    ...base,
    type,
    deviceId: a.device_id != null ? String(a.device_id) : '',
    deviceStatus: (a.status as ActionDeviceStatus) ?? 'on',
    setpoint: a.setpoint != null ? String(a.setpoint) : '21',
    thermostatMode: (a.mode as ThermostatMode) ?? 'heat',
    childLock: a.locked != null ? Boolean(a.locked) : true,
    openWindow: a.enabled != null ? Boolean(a.enabled) : true,
    calibration: a.type === 'set_thermostat_calibration' && a.value != null ? String(a.value) : '0',
    frostProtection: a.type === 'set_thermostat_frost_protection' && a.value != null ? String(a.value) : '5',
  };
}

function buildStoredAction(a: SceneActionForm): Record<string, unknown> {
  switch (a.type) {
    case 'set_device_status':
      return { type: 'set_device_status', device_id: Number(a.deviceId), status: a.deviceStatus };
    case 'toggle_device':
      return { type: 'toggle_device', device_id: Number(a.deviceId) };
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
  }
}

function describeStoredAction(a: Record<string, unknown>, devices: Device[]): string {
  const dev = (id: unknown) => devices.find((d) => d.id === Number(id))?.name ?? '?';
  const type = String(a.type ?? '');
  if (!type && a.device_id != null) {
    return `${dev(a.device_id)} → ${a.status}`;
  }
  switch (type) {
    case 'set_device_status':
      return `${dev(a.device_id)} → ${a.status}`;
    case 'toggle_device':
      return `${dev(a.device_id)} umschalten`;
    case 'set_thermostat_setpoint':
      return `${dev(a.device_id)} ${a.setpoint}°C`;
    case 'set_thermostat_mode':
      return `${dev(a.device_id)} Modus ${a.mode}`;
    case 'set_thermostat_child_lock':
      return `${dev(a.device_id)} Kindersicherung ${a.locked ? 'an' : 'aus'}`;
    case 'set_thermostat_open_window':
      return `${dev(a.device_id)} Fenster ${a.enabled ? 'an' : 'aus'}`;
    case 'set_thermostat_calibration':
      return `${dev(a.device_id)} Kalibrierung ${a.value}`;
    case 'set_thermostat_frost_protection':
      return `${dev(a.device_id)} Frostschutz ${a.value}`;
    default:
      return type || 'Aktion';
  }
}

function resolvedOnOffTarget(
  a: Record<string, unknown>,
  device: Device,
): 'on' | 'off' | null {
  const type = String(a.type ?? '');
  if (type === 'toggle_device' || (!type && a.status === 'toggle')) {
    return device.status === 'on' ? 'off' : 'on';
  }
  const status = String(a.status ?? '');
  if (status === 'on' || status === 'off') return status;
  return null;
}

export default function ScenesClient({ initialScenes, devices: initialDevices }: Props) {
  const router = useRouter();
  const storeDevices = useSmartHomeStore(s => s.devices);
  const storeScenes = useSmartHomeStore(s => s.scenes);
  const [scenes, setScenes]           = useState(initialScenes);
  const [devices, setDevices]         = useState(initialDevices);
  const [running, setRunning]         = useState<Set<number>>(new Set());
  const [resetting, setResetting]     = useState<Set<number>>(new Set());
  const [snapshots, setSnapshots]     = useState<Snapshots>({});
  const [activateError, setActivateError] = useState<string | null>(null);
  const [delayScene, setDelayScene]   = useState<Scene | null>(null);
  const [dialog, setDialog]           = useState<{
    open: boolean; editing?: Scene; form: SceneForm; saving: boolean; error: string;
  }>({ open: false, form: emptyForm(), saving: false, error: '' });
  const [deleteId, setDeleteId]       = useState<number | null>(null);

  useEffect(() => {
    if (devices.length === 0 && storeDevices.length) setDevices(storeDevices);
    if (scenes.length === 0 && storeScenes.length) setScenes(storeScenes);
  }, [storeDevices, storeScenes, devices.length, scenes.length]);

  const switchableDevices = devices.filter((d) => SWITCHABLE_TYPES.includes(d.type));
  const thermostats = devices.filter((d) => d.type === 'thermostat');

  const [, dispatch] = useReducer((x: number) => x + 1, 0);
  const forceUpdate  = useCallback(() => dispatch(), []);
  useEffect(() => {
    const bleDevices = devices.filter(isBle);
    for (const d of bleDevices) shellyBle.onStateChange(d.id, forceUpdate);
    return () => { for (const d of bleDevices) shellyBle.offStateChange(d.id); };
  }, [devices, forceUpdate]);

  useEffect(() => {
    void syncSnapshotsFromServer().then(setSnapshots);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);
    return () => window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
  }, []);

  const patchAction = (id: string, patch: Partial<SceneActionForm>) => {
    setDialog((s) => ({
      ...s,
      form: {
        ...s.form,
        actions: s.form.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      },
    }));
  };

  const moveAction = (id: string, dir: -1 | 1) => {
    setDialog((s) => {
      const actions = [...s.form.actions];
      const i = actions.findIndex((a) => a.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= actions.length) return s;
      [actions[i], actions[j]] = [actions[j], actions[i]];
      return { ...s, form: { ...s.form, actions } };
    });
  };

  /* ── Szene ausführen ──────────────────────────────────────────── */
  const activate = async (scene: Scene, delayMinutes?: number) => {
    setActivateError(null);

    if (delayMinutes && delayMinutes > 0) {
      try {
        await api.activateScene(scene.id, { delay_minutes: delayMinutes });
        toast.success(`${scene.name} startet in ${formatDelayMinutes(delayMinutes)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setActivateError(`Fehler: ${msg}`);
      }
      return;
    }

    // Snapshot nur für on/off-fähige Aktionen
    const snap: DeviceSnapshot[] = scene.actions
      .filter(isOnOffAction)
      .map((a) => {
        const id = actionDeviceId(a);
        if (id == null) return null;
        const d = devices.find((x) => x.id === id);
        if (!d || d.type === 'computer') return null;
        const status: 'on' | 'off' = d.status === 'on' ? 'on' : 'off';
        return { device_id: id, status };
      })
      .filter((x): x is DeviceSnapshot => x !== null);

    const bleOnOffActions = scene.actions.filter((a) => {
      if (!isOnOffAction(a)) return false;
      const id = actionDeviceId(a);
      if (id == null) return false;
      const d = devices.find((x) => x.id === id);
      return !!d && isBle(d);
    });
    const disconnectedBle = bleOnOffActions.filter((a) => {
      const id = actionDeviceId(a)!;
      return !shellyBle.isConnected(id);
    });
    const connectedBle = bleOnOffActions.filter((a) => {
      const id = actionDeviceId(a)!;
      return shellyBle.isConnected(id);
    });

    if (disconnectedBle.length > 0) {
      const names = disconnectedBle
        .map((a) => devices.find((x) => x.id === actionDeviceId(a))?.name ?? '?')
        .join(', ');
      setActivateError(`Bluetooth nicht verbunden: ${names} — bitte zuerst im Raum verbinden.`);
      const allBleOnOff = scene.actions.length > 0 && scene.actions.every((a) => {
        if (!isOnOffAction(a)) return false;
        const id = actionDeviceId(a);
        const d = id != null ? devices.find((x) => x.id === id) : null;
        return !!d && isBle(d);
      });
      if (allBleOnOff && connectedBle.length === 0) return;
    }

    setRunning((r) => new Set(r).add(scene.id));
    try {
      await api.activateScene(scene.id);

      await Promise.allSettled(
        connectedBle.map((a) => {
          const id = actionDeviceId(a)!;
          const d = devices.find((x) => x.id === id)!;
          const target = resolvedOnOffTarget(a, d);
          if (target == null) return Promise.resolve();
          return shellyBle.switchSet(id, target === 'on');
        }),
      );

      if (snap.length > 0) {
        const newSnapshots = { ...loadSnapshots(), [scene.id]: snap };
        void saveSnapshots(newSnapshots);
        setSnapshots(newSnapshots);
      }

      const fresh = await api.getDevices().catch(() => null);
      if (fresh) {
        setDevices(fresh);
        useSmartHomeStore.getState().hydrate({ devices: fresh });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActivateError(`Fehler: ${msg}`);
    } finally {
      setRunning((r) => { const n = new Set(r); n.delete(scene.id); return n; });
    }
  };

  /* ── Zurücksetzen ─────────────────────────────────────────────── */
  const reset = async (sceneId: number) => {
    const snap = snapshots[sceneId];
    if (!snap) return;
    setResetting((r) => new Set(r).add(sceneId));
    setActivateError(null);
    try {
      await Promise.all(snap.map((s) => api.setDeviceStatus(s.device_id, s.status)));
      await Promise.allSettled(
        snap
          .filter((s) => {
            const d = devices.find((x) => x.id === s.device_id);
            return d && isBle(d) && shellyBle.isConnected(s.device_id);
          })
          .map((s) => shellyBle.switchSet(s.device_id, s.status === 'on')),
      );
      snap.forEach((s) => emitDeviceUpdate(s.device_id, s.status));
      const newSnapshots = { ...snapshots };
      delete newSnapshots[sceneId];
      void saveSnapshots(newSnapshots);
      setSnapshots(newSnapshots);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActivateError(`Zurücksetzen fehlgeschlagen: ${msg}`);
    } finally {
      setResetting((r) => { const n = new Set(r); n.delete(sceneId); return n; });
    }
  };

  const validateForm = (form: SceneForm): string => {
    if (!form.name.trim()) return 'Name ist erforderlich.';
    if (form.actions.length === 0) return 'Mindestens eine Aktion hinzufügen.';
    for (let i = 0; i < form.actions.length; i++) {
      const a = form.actions[i];
      const label = `Aktion ${i + 1}`;
      if (!a.deviceId) return `${label}: bitte ein Gerät wählen.`;
      if (a.type === 'set_thermostat_setpoint') {
        const sp = Number(a.setpoint);
        if (Number.isNaN(sp) || sp < 4 || sp > 35) return `${label}: Sollwert 4–35°C.`;
      }
      if (a.type === 'set_thermostat_calibration') {
        const v = Number(a.calibration);
        if (Number.isNaN(v) || v < -12.7 || v > 12.7) return `${label}: Kalibrierung -12.7–12.7°C.`;
      }
      if (a.type === 'set_thermostat_frost_protection') {
        const v = Number(a.frostProtection);
        if (Number.isNaN(v) || v < 4 || v > 35) return `${label}: Frostschutz 4–35°C.`;
      }
    }
    return '';
  };

  const save = async () => {
    const { form, editing } = dialog;
    const err = validateForm(form);
    if (err) { setDialog((s) => ({ ...s, error: err })); return; }
    setDialog((s) => ({ ...s, saving: true, error: '' }));
    try {
      const payload = {
        name: form.name.trim(),
        icon: form.icon,
        actions: form.actions.map(buildStoredAction),
        active: true,
      };
      if (editing) {
        const updated = await api.updateScene(editing.id, payload);
        setScenes((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const created = await api.createScene(payload);
        setScenes((prev) => [...prev, created]);
      }
      setDialog({ open: false, form: emptyForm(), saving: false, error: '' });
    } catch {
      setDialog((s) => ({ ...s, saving: false, error: 'Speichern fehlgeschlagen.' }));
    }
  };

  const deleteScene = async (id: number) => {
    await api.deleteScene(id);
    setScenes((prev) => prev.filter((s) => s.id !== id));
    const newSnaps = { ...snapshots };
    delete newSnaps[id];
    void saveSnapshots(newSnaps);
    setSnapshots(newSnaps);
    setDeleteId(null);
  };

  const openEdit = (scene: Scene) => {
    setDialog({
      open: true,
      editing: scene,
      form: {
        name: scene.name,
        icon: scene.icon,
        actions: (scene.actions ?? []).map((a) => actionFromStored(a)),
      },
      saving: false,
      error: '',
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push('/settings')}
            className="cursor-pointer h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-all"
            aria-label="Zurück zu Einstellungen"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Szenen</h1>
            <p className="text-sm text-muted-foreground">1 Klick schaltet mehrere Geräte nacheinander</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true, editing: undefined, form: emptyForm(), saving: false, error: '' })}>
          <Plus className="h-4 w-4 mr-1" /> Neue Szene
        </Button>
      </div>

      {activateError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive flex-1">{activateError}</p>
          <button type="button" onClick={() => setActivateError(null)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground shrink-0">✕</button>
        </div>
      )}

      {scenes.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <p className="text-3xl mb-2">🎬</p>
          <p className="text-sm">Noch keine Szenen. Erstelle z.B. &ldquo;Guten Morgen&rdquo; oder &ldquo;Kinoabend&rdquo;.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {scenes.map((scene) => {
          const isRunning   = running.has(scene.id);
          const isResetting = resetting.has(scene.id);
          const hasSnapshot = !!snapshots[scene.id];
          return (
            <div key={scene.id} className="rounded-xl border bg-card p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl leading-none">{scene.icon}</span>
                  <p className="font-semibold text-sm leading-tight">{scene.name}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => openEdit(scene)}
                    className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setDeleteId(scene.id)}
                    className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{scene.actions.length} Aktion{scene.actions.length !== 1 ? 'en' : ''}</p>
              <ul className="text-[10px] text-muted-foreground space-y-0.5 line-clamp-3">
                {scene.actions.slice(0, 3).map((a, i) => (
                  <li key={i} className="truncate">{describeStoredAction(a, devices)}</li>
                ))}
                {scene.actions.length > 3 && <li>…</li>}
              </ul>

              {hasSnapshot && (
                <button
                  type="button"
                  onClick={() => reset(scene.id)}
                  disabled={isResetting}
                  className={cn(
                    'cursor-pointer w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium border transition-all active:scale-95',
                    isResetting
                      ? 'opacity-50 cursor-not-allowed'
                      : 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
                  )}
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isResetting && 'animate-spin')} />
                  {isResetting ? 'Zurücksetzen…' : 'Zurücksetzen'}
                </button>
              )}

              <button
                type="button"
                onClick={() => activate(scene)}
                disabled={isRunning}
                className={cn(
                  'cursor-pointer mt-auto w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all active:scale-95',
                  isRunning
                    ? 'bg-muted text-muted-foreground animate-pulse'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <Play className="h-4 w-4" />
                {isRunning ? 'Wird ausgeführt…' : 'Ausführen'}
              </button>
              <button
                type="button"
                onClick={() => setDelayScene(scene)}
                disabled={isRunning}
                className="cursor-pointer w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium border border-border hover:bg-accent transition-all active:scale-95 disabled:opacity-50"
              >
                <Timer className="h-4 w-4" />
                Ausführen in…
              </button>
            </div>
          );
        })}
      </div>

      <Dialog open={dialog.open} onOpenChange={(open) => !open && setDialog({ open: false, form: emptyForm(), saving: false, error: '' })}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.editing ? 'Szene bearbeiten' : 'Neue Szene'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={dialog.form.name}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))}
                placeholder="z.B. Kinoabend"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Icon</label>
              <div className="flex flex-wrap gap-2">
                {SCENE_ICONS.map((icon) => (
                  <button key={icon} type="button" onClick={() => setDialog((s) => ({ ...s, form: { ...s.form, icon } }))}
                    className={cn(
                      'cursor-pointer text-xl h-9 w-9 flex items-center justify-center rounded-lg border transition-all',
                      dialog.form.icon === icon ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent',
                    )}>{icon}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Aktionen</label>
                <Button size="sm" variant="outline" type="button"
                  onClick={() => setDialog((s) => ({
                    ...s,
                    form: { ...s.form, actions: [...s.form.actions, newAction(devices)] },
                  }))}>
                  <Plus className="h-3 w-3 mr-1" /> Aktion
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Reihenfolge = Ausführungsreihenfolge. Bei Sperren zuerst das Gerät, das die Sperre auslöst.
              </p>

              {dialog.form.actions.map((action, idx) => {
                const target = switchableDevices.find((d) => String(d.id) === action.deviceId)
                  ?? thermostats.find((d) => String(d.id) === action.deviceId);
                const isCover = target?.type === 'cover';
                const isComputer = target?.type === 'computer';
                const needsThermostat = action.type.startsWith('set_thermostat_');
                const deviceList = needsThermostat
                  ? thermostats
                  : action.type === 'toggle_device'
                    ? switchableDevices.filter((d) => d.type !== 'computer')
                    : switchableDevices;

                return (
                  <div key={action.id} className="rounded-md border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Aktion {idx + 1}
                      </p>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveAction(action.id, -1)}
                          disabled={idx === 0}
                          className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Nach oben"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAction(action.id, 1)}
                          disabled={idx === dialog.form.actions.length - 1}
                          className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Nach unten"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog((s) => ({
                            ...s,
                            form: { ...s.form, actions: s.form.actions.filter((a) => a.id !== action.id) },
                          }))}
                          className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <Select
                      value={action.type}
                      onValueChange={(v) => {
                        const type = v as SceneActionType;
                        const patch: Partial<SceneActionForm> = { type };
                        if (type.startsWith('set_thermostat_') && thermostats[0]) {
                          patch.deviceId = String(thermostats[0].id);
                        } else if (!type.startsWith('set_thermostat_') && switchableDevices[0]) {
                          const cur = devices.find((d) => String(d.id) === action.deviceId);
                          if (!cur || cur.type === 'thermostat') {
                            patch.deviceId = String(switchableDevices[0].id);
                          }
                        }
                        patchAction(action.id, patch);
                      }}
                    >
                      <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Gerät</SelectLabel>
                          <SelectItem value="set_device_status">Ein-/Ausschalten / Cover</SelectItem>
                          <SelectItem value="toggle_device">Umschalten</SelectItem>
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Thermostat</SelectLabel>
                          <SelectItem value="set_thermostat_setpoint">Sollwert</SelectItem>
                          <SelectItem value="set_thermostat_mode">Modus</SelectItem>
                          <SelectItem value="set_thermostat_child_lock">Kindersicherung</SelectItem>
                          <SelectItem value="set_thermostat_open_window">Offenes Fenster</SelectItem>
                          <SelectItem value="set_thermostat_calibration">Kalibrierung</SelectItem>
                          <SelectItem value="set_thermostat_frost_protection">Frostschutz</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>

                    <Select
                      value={action.deviceId}
                      onValueChange={(v) => {
                        const next = devices.find((d) => String(d.id) === v);
                        const patch: Partial<SceneActionForm> = { deviceId: v };
                        if (next?.type === 'cover' && !['open', 'close', 'stop'].includes(action.deviceStatus)) {
                          patch.deviceStatus = 'open';
                        } else if (next?.type === 'computer') {
                          patch.deviceStatus = 'on';
                          if (action.type === 'toggle_device') patch.type = 'set_device_status';
                        } else if (next && next.type !== 'cover' && ['open', 'close', 'stop'].includes(action.deviceStatus)) {
                          patch.deviceStatus = 'on';
                        }
                        patchAction(action.id, patch);
                      }}
                    >
                      <SelectTrigger className="w-full h-8 text-xs"><SelectValue placeholder="Gerät…" /></SelectTrigger>
                      <SelectContent>
                        {deviceList.length === 0 ? (
                          <SelectItem value="_" disabled>Keine Geräte</SelectItem>
                        ) : (
                          deviceList.map((d) => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              {d.name}{' '}
                              <span className="text-muted-foreground">
                                ({deviceLabels[d.type as DeviceType] ?? d.type})
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>

                    {action.type === 'set_device_status' && (
                      <Select
                        value={action.deviceStatus}
                        onValueChange={(v) => patchAction(action.id, { deviceStatus: v as ActionDeviceStatus })}
                      >
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {isCover ? (
                            <>
                              <SelectItem value="open">Öffnen</SelectItem>
                              <SelectItem value="close">Schließen</SelectItem>
                              <SelectItem value="stop">Stopp</SelectItem>
                            </>
                          ) : isComputer ? (
                            <SelectItem value="on">Starten</SelectItem>
                          ) : (
                            <>
                              <SelectItem value="on">Einschalten</SelectItem>
                              <SelectItem value="off">Ausschalten</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    )}

                    {action.type === 'set_thermostat_setpoint' && (
                      <input
                        type="number"
                        step={0.5}
                        min={4}
                        max={35}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        value={action.setpoint}
                        onChange={(e) => patchAction(action.id, { setpoint: e.target.value })}
                        placeholder="Sollwert °C"
                      />
                    )}

                    {action.type === 'set_thermostat_mode' && (
                      <Select
                        value={action.thermostatMode}
                        onValueChange={(v) => patchAction(action.id, { thermostatMode: v as ThermostatMode })}
                      >
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="heat">Heizen</SelectItem>
                          <SelectItem value="off">Aus</SelectItem>
                          <SelectItem value="auto">Auto</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    {action.type === 'set_thermostat_child_lock' && (
                      <Select
                        value={action.childLock ? 'true' : 'false'}
                        onValueChange={(v) => patchAction(action.id, { childLock: v === 'true' })}
                      >
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">an (LOCK)</SelectItem>
                          <SelectItem value="false">aus (UNLOCK)</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    {action.type === 'set_thermostat_open_window' && (
                      <Select
                        value={action.openWindow ? 'true' : 'false'}
                        onValueChange={(v) => patchAction(action.id, { openWindow: v === 'true' })}
                      >
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">an (ON)</SelectItem>
                          <SelectItem value="false">aus (OFF)</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    {action.type === 'set_thermostat_calibration' && (
                      <input
                        type="number"
                        step={0.2}
                        min={-12.7}
                        max={12.7}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        value={action.calibration}
                        onChange={(e) => patchAction(action.id, { calibration: e.target.value })}
                        placeholder="Kalibrierung °C"
                      />
                    )}

                    {action.type === 'set_thermostat_frost_protection' && (
                      <input
                        type="number"
                        step={0.5}
                        min={4}
                        max={35}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        value={action.frostProtection}
                        onChange={(e) => patchAction(action.id, { frostProtection: e.target.value })}
                        placeholder="Frostschutz °C"
                      />
                    )}
                  </div>
                );
              })}

              {dialog.form.actions.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Noch keine Aktionen. Klicke auf &ldquo;+ Aktion&rdquo;.</p>
              )}
            </div>
            {dialog.error && <p className="text-sm text-destructive">{dialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog({ open: false, form: emptyForm(), saving: false, error: '' })}>Abbrechen</Button>
            <Button onClick={save} disabled={dialog.saving}>{dialog.saving ? 'Speichern…' : 'Speichern'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Szene löschen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Diese Szene wird dauerhaft gelöscht.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteScene(deleteId)}>Löschen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SceneDelayDialog
        open={delayScene != null}
        sceneName={delayScene?.name ?? ''}
        onClose={() => setDelayScene(null)}
        onConfirm={(minutes) => {
          const scene = delayScene;
          setDelayScene(null);
          if (scene) void activate(scene, minutes);
        }}
      />
    </div>
  );
}
