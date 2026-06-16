'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { api, Device, Scene } from '@/lib/api';
import { cn } from '@/lib/utils';
import { deviceLabels } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { Plus, Pencil, Trash2, Play, RotateCcw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { shellyBle } from '@/lib/bluetooth';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';

const SCENE_ICONS = ['🎬','💡','🌙','☀️','🎵','🍿','🏠','😴','🚗','🌿','🎮','📖'];
const SNAPSHOTS_KEY = 'smarthome_scene_snapshots';

type DeviceSnapshot = { device_id: number; status: 'on' | 'off' };
type Snapshots = Record<number, DeviceSnapshot[]>;

interface Props { initialScenes: Scene[]; devices: Device[] }
interface SceneAction { device_id: number; status: 'on' | 'off' | 'toggle' }
interface SceneForm { name: string; icon: string; actions: SceneAction[] }

const emptyForm = (): SceneForm => ({ name: '', icon: '🎬', actions: [] });

function isBle(device: Device) {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

function loadSnapshots(): Snapshots {
  try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) ?? '{}'); } catch { return {}; }
}
function saveSnapshots(s: Snapshots) {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(s));
}

export default function ScenesClient({ initialScenes, devices: initialDevices }: Props) {
  const [scenes, setScenes]           = useState(initialScenes);
  const [devices, setDevices]         = useState(initialDevices);
  const [running, setRunning]         = useState<Set<number>>(new Set());
  const [resetting, setResetting]     = useState<Set<number>>(new Set());
  const [snapshots, setSnapshots]     = useState<Snapshots>({});
  const [activateError, setActivateError] = useState<string | null>(null);
  const [dialog, setDialog]           = useState<{
    open: boolean; editing?: Scene; form: SceneForm; saving: boolean; error: string;
  }>({ open: false, form: emptyForm(), saving: false, error: '' });
  const [deleteId, setDeleteId]       = useState<number | null>(null);

  // BLE-State-Listener → Re-Render bei Verbindungsänderung
  const [, dispatch] = useReducer((x: number, _?: unknown) => x + 1, 0);
  const forceUpdate  = useCallback(() => dispatch(0), []);
  useEffect(() => {
    const bleDevices = devices.filter(isBle);
    for (const d of bleDevices) shellyBle.onStateChange(d.id, forceUpdate);
    return () => { for (const d of bleDevices) shellyBle.offStateChange(d.id); };
  }, [devices, forceUpdate]);

  // Gespeicherte Snapshots laden
  useEffect(() => { setSnapshots(loadSnapshots()); }, []);

  // Gerätezustand-Updates von anderen Komponenten empfangen
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);
    return () => window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
  }, []);

  /* ── Szene ausführen ──────────────────────────────────────────── */
  const activate = async (scene: Scene) => {
    setActivateError(null);

    // Snapshot des Ist-Zustands ALLER betroffenen Geräte speichern
    const snap: DeviceSnapshot[] = scene.actions
      .map(a => {
        const d = devices.find(x => x.id === a.device_id);
        if (!d) return null;
        // 'unknown' oder andere Werte → als 'off' behandeln
        const status: 'on' | 'off' = d.status === 'on' ? 'on' : 'off';
        return { device_id: a.device_id, status };
      })
      .filter((x): x is DeviceSnapshot => x !== null);

    // BLE-Geräte prüfen
    const bleActions = scene.actions.filter(a => {
      const d = devices.find(x => x.id === a.device_id);
      return d && isBle(d);
    });
    const disconnectedBle = bleActions.filter(a => !shellyBle.isConnected(a.device_id));
    const connectedBle    = bleActions.filter(a =>  shellyBle.isConnected(a.device_id));

    if (disconnectedBle.length > 0) {
      const names = disconnectedBle
        .map(a => devices.find(x => x.id === a.device_id)?.name ?? `Gerät ${a.device_id}`)
        .join(', ');
      setActivateError(`Bluetooth nicht verbunden: ${names} — bitte zuerst im Raum verbinden.`);
      if (connectedBle.length === 0 && bleActions.length === scene.actions.length) return;
    }

    setRunning(r => new Set(r).add(scene.id));
    try {
      await api.activateScene(scene.id);

      // Verbundene BLE-Geräte direkt über Web Bluetooth schalten
      await Promise.allSettled(
        connectedBle.map(a => {
          const d = devices.find(x => x.id === a.device_id)!;
          const on = a.status === 'toggle' ? d.status !== 'on' : a.status === 'on';
          return shellyBle.switchSet(a.device_id, on);
        })
      );

      // Snapshot in localStorage & State speichern
      const newSnapshots = { ...loadSnapshots(), [scene.id]: snap };
      saveSnapshots(newSnapshots);
      setSnapshots(newSnapshots);

      // Anderen Komponenten Bescheid geben
      for (const a of scene.actions) {
        const d = devices.find(x => x.id === a.device_id);
        if (!d || a.status === 'toggle') continue;
        emitDeviceUpdate(a.device_id, a.status);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActivateError(`Fehler: ${msg}`);
    } finally {
      setRunning(r => { const n = new Set(r); n.delete(scene.id); return n; });
    }
  };

  /* ── Zurücksetzen ─────────────────────────────────────────────── */
  const reset = async (sceneId: number) => {
    const snap = snapshots[sceneId];
    if (!snap) return;
    setResetting(r => new Set(r).add(sceneId));
    setActivateError(null);
    try {
      // Server-API für alle Geräte (MQTT / HTTP / BLE-Bridge)
      await Promise.all(snap.map(s => api.setDeviceStatus(s.device_id, s.status)));

      // Direkt per Web Bluetooth für verbundene BLE-Geräte
      await Promise.allSettled(
        snap
          .filter(s => {
            const d = devices.find(x => x.id === s.device_id);
            return d && isBle(d) && shellyBle.isConnected(s.device_id);
          })
          .map(s => shellyBle.switchSet(s.device_id, s.status === 'on'))
      );

      snap.forEach(s => emitDeviceUpdate(s.device_id, s.status));
      const newSnapshots = { ...snapshots };
      delete newSnapshots[sceneId];
      saveSnapshots(newSnapshots);
      setSnapshots(newSnapshots);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActivateError(`Zurücksetzen fehlgeschlagen: ${msg}`);
    } finally {
      setResetting(r => { const n = new Set(r); n.delete(sceneId); return n; });
    }
  };

  /* ── Speichern ────────────────────────────────────────────────── */
  const save = async () => {
    const { form, editing } = dialog;
    if (!form.name.trim()) { setDialog(s => ({ ...s, error: 'Name ist erforderlich.' })); return; }
    if (form.actions.length === 0) { setDialog(s => ({ ...s, error: 'Mindestens eine Aktion hinzufügen.' })); return; }
    setDialog(s => ({ ...s, saving: true, error: '' }));
    try {
      const payload = { name: form.name.trim(), icon: form.icon, actions: form.actions, active: true };
      if (editing) {
        const updated = await api.updateScene(editing.id, payload);
        setScenes(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        const created = await api.createScene(payload);
        setScenes(prev => [...prev, created]);
      }
      setDialog({ open: false, form: emptyForm(), saving: false, error: '' });
    } catch {
      setDialog(s => ({ ...s, saving: false, error: 'Speichern fehlgeschlagen.' }));
    }
  };

  const deleteScene = async (id: number) => {
    await api.deleteScene(id);
    setScenes(prev => prev.filter(s => s.id !== id));
    const newSnaps = { ...snapshots };
    delete newSnaps[id];
    saveSnapshots(newSnaps);
    setSnapshots(newSnaps);
    setDeleteId(null);
  };

  const addAction = () =>
    setDialog(s => ({ ...s, form: { ...s.form, actions: [...s.form.actions, { device_id: devices[0]?.id ?? 0, status: 'on' }] } }));
  const updateAction = (i: number, patch: Partial<SceneAction>) =>
    setDialog(s => ({ ...s, form: { ...s.form, actions: s.form.actions.map((a, idx) => idx === i ? { ...a, ...patch } : a) } }));
  const removeAction = (i: number) =>
    setDialog(s => ({ ...s, form: { ...s.form, actions: s.form.actions.filter((_, idx) => idx !== i) } }));

  return (
    <div className="space-y-5">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Szenen</h1>
          <p className="text-sm text-muted-foreground">1 Klick schaltet mehrere Geräte gleichzeitig</p>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true, editing: undefined, form: emptyForm(), saving: false, error: '' })}>
          <Plus className="h-4 w-4 mr-1" /> Neue Szene
        </Button>
      </div>

      {/* ── Fehler ────────────────────────────────────────────────── */}
      {activateError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive flex-1">{activateError}</p>
          <button onClick={() => setActivateError(null)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground shrink-0">✕</button>
        </div>
      )}

      {/* ── Leer-Zustand ──────────────────────────────────────────── */}
      {scenes.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <p className="text-3xl mb-2">🎬</p>
          <p className="text-sm">Noch keine Szenen. Erstelle z.B. &ldquo;Guten Morgen&rdquo; oder &ldquo;Kinoabend&rdquo;.</p>
        </div>
      )}

      {/* ── Szenen-Grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {scenes.map(scene => {
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
                  <button onClick={() => setDialog({ open: true, editing: scene, form: { name: scene.name, icon: scene.icon, actions: scene.actions.map(a => ({ ...a })) }, saving: false, error: '' })}
                    className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleteId(scene.id)}
                    className="cursor-pointer h-7 w-7 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{scene.actions.length} Aktion{scene.actions.length !== 1 ? 'en' : ''}</p>

              {/* Zurücksetzen-Button — erscheint nach Ausführung, bleibt bis zum Reset */}
              {hasSnapshot && (
                <button
                  onClick={() => reset(scene.id)}
                  disabled={isResetting}
                  className={cn(
                    'cursor-pointer w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium border transition-all active:scale-95',
                    isResetting
                      ? 'opacity-50 cursor-not-allowed'
                      : 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
                  )}
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isResetting && 'animate-spin')} />
                  {isResetting ? 'Zurücksetzen…' : 'Zurücksetzen'}
                </button>
              )}

              {/* Ausführen-Button */}
              <button
                onClick={() => activate(scene)}
                disabled={isRunning}
                className={cn(
                  'cursor-pointer mt-auto w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all active:scale-95',
                  isRunning
                    ? 'bg-muted text-muted-foreground animate-pulse'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                <Play className="h-4 w-4" />
                {isRunning ? 'Wird ausgeführt…' : 'Ausführen'}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Szene erstellen/bearbeiten ────────────────────────────── */}
      <Dialog open={dialog.open} onOpenChange={open => !open && setDialog({ open: false, form: emptyForm(), saving: false, error: '' })}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog.editing ? 'Szene bearbeiten' : 'Neue Szene'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={dialog.form.name}
                onChange={e => setDialog(s => ({ ...s, form: { ...s.form, name: e.target.value } }))}
                placeholder="z.B. Kinoabend"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Icon</label>
              <div className="flex flex-wrap gap-2">
                {SCENE_ICONS.map(icon => (
                  <button key={icon} onClick={() => setDialog(s => ({ ...s, form: { ...s.form, icon } }))}
                    className={cn(
                      'cursor-pointer text-xl h-9 w-9 flex items-center justify-center rounded-lg border transition-all',
                      dialog.form.icon === icon ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                    )}>{icon}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Aktionen</label>
                <Button size="sm" variant="outline" onClick={addAction}>
                  <Plus className="h-3 w-3 mr-1" /> Aktion
                </Button>
              </div>
              {dialog.form.actions.map((action, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={String(action.device_id)} onValueChange={v => updateAction(i, { device_id: Number(v) })}>
                    <SelectTrigger className="flex-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {devices.map(d => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name} <span className="text-muted-foreground">({deviceLabels[d.type as DeviceType] ?? d.type})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={action.status} onValueChange={v => updateAction(i, { status: v as SceneAction['status'] })}>
                    <SelectTrigger className="w-24 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on">Einschalten</SelectItem>
                      <SelectItem value="off">Ausschalten</SelectItem>
                      <SelectItem value="toggle">Umschalten</SelectItem>
                    </SelectContent>
                  </Select>
                  <button onClick={() => removeAction(i)}
                    className="cursor-pointer h-8 w-8 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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

      {/* ── Löschen bestätigen ────────────────────────────────────── */}
      <Dialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Szene löschen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Diese Szene wird dauerhaft gelöscht.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteScene(deleteId)}>Löschen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
