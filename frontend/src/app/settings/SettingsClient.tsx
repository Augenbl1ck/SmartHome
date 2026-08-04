'use client';

import { useState } from 'react';
import { api, Device, DeviceType, Room } from '@/lib/api';
import { deviceLabels } from '@/lib/devices';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Pencil, Plus, Trash2, Wifi, LockKeyhole, LockKeyholeOpen, Timer,
  ChevronDown, Home, Cpu, Cloud, LayoutDashboard,
} from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────
// Typen & Konstanten
// ─────────────────────────────────────────────────────────────────

interface Props { initialRooms: Room[]; initialDevices: Device[] }

const DEVICE_TYPES: DeviceType[] = [
  // Licht & Schalten
  'light', 'plug', 'switch', 'dimmer', 'rgb', 'led',
  // Steuerung
  'fan', 'cover', 'thermostat', 'valve', 'button',
  // Energie
  'energy_meter',
  // Sensoren
  'sensor_temperature', 'sensor_humidity', 'sensor_motion',
  'sensor_door', 'sensor_flood', 'sensor_smoke', 'sensor_lux', 'sensor_vibration',
  // Sonstiges
  'other',
];

const ROOM_ICONS = ['🛋️', '🛏️', '🍳', '🚿', '🏠', '💡', '📦', '🪴', '🖥️', '🎮'];

type DeviceProtocol = 'simple' | 'shelly_gen3' | 'shelly_gen1' | 'shelly_gen3_http' | 'bluetooth_shelly_gen3';

const PROTOCOLS: { value: DeviceProtocol; label: string; hint: string }[] = [
  { value: 'simple',                label: 'Einfach (MQTT)',        hint: 'Schickt "on"/"off" direkt ans MQTT-Topic.' },
  { value: 'shelly_gen3',           label: 'Shelly Gen3 (MQTT)',    hint: 'Topic: shellygen3/shellyplugsg3-XXXXXX' },
  { value: 'shelly_gen1',           label: 'Shelly Gen1/2 (MQTT)',  hint: 'Topic: shellies/shellyplug-s-XXXXXX' },
  { value: 'shelly_gen3_http',      label: 'Shelly Gen3 (LAN/HTTP)','hint': 'Direkter HTTP-Zugriff — ideal für Raspberry Pi. IP des Shelly eintragen.' },
  { value: 'bluetooth_shelly_gen3', label: 'Shelly Gen3 (Bluetooth)','hint': 'Web Bluetooth (Chrome/Edge) oder BLE Bridge auf dem Pi.' },
];

// ─────────────────────────────────────────────────────────────────
// Hilfselemente
// ─────────────────────────────────────────────────────────────────

/** Eingabefeld das auf dem Raspberry die Bildschirmtastatur öffnet */
function Field({
  label, value, onChange, placeholder, hint,
  type = 'text', inputMode, pattern, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string;
  type?: 'text' | 'tel' | 'number' | 'password';
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>['inputMode'];
  pattern?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <input
        className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        pattern={pattern}
        autoComplete={autoComplete}
        /* py-2.5 + text-base ensures mobile browsers open the keyboard */
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Aufklappbare Sektion */
function Section({
  title, icon: Icon, badge, children, defaultOpen = false,
}: {
  title: string; icon: React.ElementType; badge?: number | string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors"
      >
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="font-semibold flex-1">{title}</span>
        {badge !== undefined && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full mr-1">
            {badge}
          </span>
        )}
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Gerät-Formular-State
// ─────────────────────────────────────────────────────────────────

interface DeviceForm {
  name: string; type: DeviceType; room_id: string;
  mqtt_topic: string; mqtt_protocol: DeviceProtocol; ble_address: string; active: boolean;
}

const emptyDevice = (): DeviceForm => ({
  name: '', type: 'light', room_id: '', mqtt_topic: '',
  mqtt_protocol: 'simple', ble_address: '', active: true,
});

function deviceToForm(d: Device): DeviceForm {
  return {
    name: d.name, type: d.type, room_id: String(d.room_id),
    mqtt_topic: d.mqtt_topic ?? '',
    mqtt_protocol: (d.attributes?.protocol as DeviceProtocol) ?? 'simple',
    ble_address: (d.attributes?.ble_address as string) ?? '',
    active: d.active,
  };
}

// ─────────────────────────────────────────────────────────────────
// Hauptkomponente
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Dashboard-Widget-Einstellungen (localStorage)
// ─────────────────────────────────────────────────────────────────

const WIDGETS_KEY = 'smarthome_dashboard_widgets';

function DashboardWidgetsSection({ devices }: { devices: Device[] }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);

  // Beim Mount aus localStorage laden
  useState(() => {
    try {
      const raw = localStorage.getItem(WIDGETS_KEY);
      if (raw) setSelected(JSON.parse(raw));
    } catch { /* */ }
  });

  const toggle = (id: number) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2)  return prev; // max 2
      return [...prev, id];
    });
  };

  const save = () => {
    localStorage.setItem(WIDGETS_KEY, JSON.stringify(selected));
    // Andere Tabs informieren (DashboardLive lauscht auf storage-Event)
    window.dispatchEvent(new StorageEvent('storage', { key: WIDGETS_KEY }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => {
    setSelected([]);
    localStorage.removeItem(WIDGETS_KEY);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Section title="Dashboard-Widgets" icon={LayoutDashboard}>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Wähle bis zu <strong>2 Geräte oder Sensoren</strong>, die oben auf dem Dashboard als Status-Kacheln angezeigt werden (nur lesend, kein Schalten).
        </p>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {devices.map(d => {
            const checked = selected.includes(d.id);
            const disabled = !checked && selected.length >= 2;
            return (
              <label key={d.id}
                className={cn(
                  'flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer select-none transition-colors',
                  checked ? 'bg-primary/10 border border-primary/30' : 'border border-transparent hover:bg-accent',
                  disabled && 'opacity-40 cursor-not-allowed'
                )}
              >
                <input type="checkbox" checked={checked} disabled={disabled}
                  onChange={() => toggle(d.id)}
                  className="accent-primary h-4 w-4 shrink-0 cursor-pointer" />
                <span className="text-sm font-medium flex-1 truncate">{d.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{d.type.replace('sensor_', '')}</span>
              </label>
            );
          })}
          {devices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Keine Geräte vorhanden.</p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {selected.length}/2 ausgewählt
          {selected.length === 0 && ' — Standard: erster Temp- und Feuchte-Sensor'}
        </p>
        <div className="flex gap-2">
          <Button onClick={save} size="sm">
            {saved ? '✓ Gespeichert' : 'Speichern'}
          </Button>
          {selected.length > 0 && (
            <Button onClick={reset} size="sm" variant="outline">Zurücksetzen</Button>
          )}
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Wetter-Einstellungen (localStorage)
// ─────────────────────────────────────────────────────────────────

const WEATHER_KEY = 'smarthome_weather_cfg';

function WeatherSection() {
  const [city, setCity] = useState('');
  const [unit, setUnit] = useState<'metric' | 'imperial'>('metric');
  const [saved, setSaved] = useState(false);

  useState(() => {
    try {
      const raw = localStorage.getItem(WEATHER_KEY);
      if (raw) { const c = JSON.parse(raw); setCity(c.city ?? ''); setUnit(c.unit ?? 'metric'); }
    } catch { /* */ }
  });

  const save = () => {
    localStorage.setItem(WEATHER_KEY, JSON.stringify({ city: city.trim(), unit }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Section title="Wetter-Widget" icon={Cloud}>
      <div className="divide-y">
        <div className="px-4 py-3 space-y-3">
          <Field label="Stadt" value={city} onChange={setCity} placeholder="z.B. Berlin" />
          <div className="space-y-1">
            <label className="block text-sm font-medium">Einheit</label>
            <select value={unit} onChange={e => setUnit(e.target.value as 'metric' | 'imperial')}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="metric">Celsius (°C)</option>
              <option value="imperial">Fahrenheit (°F)</option>
            </select>
          </div>
          <Button onClick={save} size="sm">
            {saved ? '✓ Gespeichert' : 'Speichern'}
          </Button>
        </div>
      </div>
    </Section>
  );
}

export default function SettingsClient({ initialRooms, initialDevices }: Props) {
  const [rooms, setRooms]     = useState(initialRooms);
  const [devices, setDevices] = useState(initialDevices);
  const pinLock = usePinLockContext();

  // ── Gerät-Dialog ────────────────────────────────────────────────
  const [deviceDialog, setDeviceDialog] = useState<{
    open: boolean; editing?: Device; form: DeviceForm; saving: boolean; error: string;
  }>({ open: false, form: emptyDevice(), saving: false, error: '' });

  const openDevice = (d?: Device) => setDeviceDialog({
    open: true, editing: d, form: d ? deviceToForm(d) : emptyDevice(), saving: false, error: '',
  });
  const patchDevice = (patch: Partial<DeviceForm>) =>
    setDeviceDialog(s => ({ ...s, form: { ...s.form, ...patch } }));

  const saveDevice = async () => {
    const { form, editing } = deviceDialog;
    if (!form.name.trim()) { setDeviceDialog(s => ({ ...s, error: 'Name ist erforderlich.' })); return; }
    if (!form.room_id)     { setDeviceDialog(s => ({ ...s, error: 'Bitte einen Raum wählen.' })); return; }
    setDeviceDialog(s => ({ ...s, saving: true, error: '' }));
    try {
      const attrs: Record<string, string> = { protocol: form.mqtt_protocol };
      if (form.ble_address.trim()) attrs.ble_address = form.ble_address.trim();
      const payload: Record<string, unknown> = {
        name: form.name.trim(), type: form.type, room_id: Number(form.room_id),
        active: form.active, attributes: attrs,
      };
      if (form.mqtt_topic.trim()) payload.mqtt_topic = form.mqtt_topic.trim();
      else payload.mqtt_topic = null;
      if (editing) {
        const updated = await api.updateDevice(editing.id, payload);
        setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
      } else {
        const created = await api.createDevice(payload);
        setDevices(prev => [...prev, created]);
      }
      setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeviceDialog(s => ({ ...s, saving: false, error: msg || 'Speichern fehlgeschlagen.' }));
    }
  };

  // ── Raum-Dialog ─────────────────────────────────────────────────
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean; editing?: Room; name: string; icon: string; saving: boolean; error: string;
  }>({ open: false, name: '', icon: '🏠', saving: false, error: '' });

  const openRoom = (r?: Room) => setRoomDialog({
    open: true, editing: r, name: r?.name ?? '', icon: r?.icon ?? '🏠', saving: false, error: '',
  });

  const saveRoom = async () => {
    const { name, icon, editing } = roomDialog;
    if (!name.trim()) { setRoomDialog(s => ({ ...s, error: 'Name ist erforderlich.' })); return; }
    setRoomDialog(s => ({ ...s, saving: true, error: '' }));
    try {
      const payload = { name: name.trim(), icon };
      if (editing) {
        const updated = await api.updateRoom(editing.id, payload);
        setRooms(prev => prev.map(r => r.id === updated.id ? updated : r));
      } else {
        const created = await api.createRoom(payload);
        setRooms(prev => [...prev, created]);
      }
      setRoomDialog({ open: false, editing: undefined, name: '', icon: '🏠', saving: false, error: '' });
    } catch {
      setRoomDialog(s => ({ ...s, saving: false, error: 'Speichern fehlgeschlagen.' }));
    }
  };

  // ── Löschen ─────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean; type: 'device' | 'room'; id: number; label: string;
  } | null>(null);

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'device') {
      await api.deleteDevice(deleteConfirm.id);
      setDevices(prev => prev.filter(d => d.id !== deleteConfirm.id));
    } else {
      await api.deleteRoom(deleteConfirm.id);
      setRooms(prev => prev.filter(r => r.id !== deleteConfirm.id));
      setDevices(prev => prev.filter(d => d.room_id !== deleteConfirm.id));
    }
    setDeleteConfirm(null);
  };

  // ── PIN-Dialog ──────────────────────────────────────────────────
  const [pinDialog, setPinDialog] = useState<{
    open: boolean; mode: 'set' | 'change' | 'remove';
    oldPin: string; newPin: string; confirmPin: string; error: string; saving: boolean;
  }>({ open: false, mode: 'set', oldPin: '', newPin: '', confirmPin: '', error: '', saving: false });

  const openPin = (mode: 'set' | 'change' | 'remove') =>
    setPinDialog({ open: true, mode, oldPin: '', newPin: '', confirmPin: '', error: '', saving: false });

  const savePin = async () => {
    const { mode, oldPin, newPin, confirmPin } = pinDialog;
    setPinDialog(s => ({ ...s, saving: true, error: '' }));
    if (mode === 'remove') {
      const ok = await pinLock.setPin(oldPin, oldPin);
      if (!ok) { setPinDialog(s => ({ ...s, saving: false, error: 'Falscher PIN' })); return; }
      pinLock.removePin();
      setPinDialog(s => ({ ...s, open: false, saving: false }));
      return;
    }
    if (newPin.length < 4) { setPinDialog(s => ({ ...s, saving: false, error: 'PIN muss 4 Ziffern haben' })); return; }
    if (newPin !== confirmPin) { setPinDialog(s => ({ ...s, saving: false, error: 'PINs stimmen nicht überein' })); return; }
    const ok = await pinLock.setPin(mode === 'change' ? oldPin : null, newPin);
    if (!ok) { setPinDialog(s => ({ ...s, saving: false, error: 'Alter PIN falsch' })); return; }
    setPinDialog(s => ({ ...s, open: false, saving: false }));
  };

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  const proto = deviceDialog.form.mqtt_protocol;
  const isBle  = proto === 'bluetooth_shelly_gen3';
  const isHttp = proto === 'shelly_gen3_http';
  const showTopic = !isBle && !isHttp;

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold">Einstellungen</h1>

      {/* ── Geräte ────────────────────────────────────────────────── */}
      <Section title="Geräte" icon={Cpu} badge={devices.length}>
        <div className="p-3 space-y-2">
          <Button size="sm" className="w-full" onClick={() => openDevice()}>
            <Plus className="h-4 w-4 mr-1" /> Neues Gerät
          </Button>

          {devices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Noch keine Geräte.</p>
          )}
          {devices.map(device => {
            const room = rooms.find(r => r.id === device.room_id);
            return (
              <div key={device.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{device.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <Badge variant="outline" className="text-xs py-0">{deviceLabels[device.type] ?? device.type}</Badge>
                    {room && <span className="text-xs text-muted-foreground">{room.icon} {room.name}</span>}
                    {device.mqtt_topic && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                        <Wifi className="h-3 w-3" />{device.mqtt_topic}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openDevice(device)}
                    className="cursor-pointer h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors">
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ open: true, type: 'device', id: device.id, label: device.name })}
                    className="cursor-pointer h-8 w-8 flex items-center justify-center rounded-lg hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Räume ─────────────────────────────────────────────────── */}
      <Section title="Räume" icon={Home} badge={rooms.length}>
        <div className="p-3 space-y-2">
          <Button size="sm" className="w-full" variant="outline" onClick={() => openRoom()}>
            <Plus className="h-4 w-4 mr-1" /> Neuer Raum
          </Button>

          {rooms.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Noch keine Räume.</p>
          )}
          {rooms.map(room => {
            const count = devices.filter(d => d.room_id === room.id).length;
            return (
              <div key={room.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <span className="text-xl shrink-0">{room.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{room.name}</p>
                  <p className="text-xs text-muted-foreground">{count} Gerät{count !== 1 ? 'e' : ''}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openRoom(room)}
                    className="cursor-pointer h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors">
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm({ open: true, type: 'room', id: room.id, label: room.name })}
                    className="cursor-pointer h-8 w-8 flex items-center justify-center rounded-lg hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── PIN & Sicherheit ──────────────────────────────────────── */}
      <Section title="PIN & Bildschirmsperre" icon={LockKeyhole}>
        <div className="divide-y">

          {/* PIN aktivieren / ändern / entfernen */}
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div>
              <p className="text-sm font-medium">PIN-Sperre</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pinLock.hasPin ? 'Aktiviert' : 'Deaktiviert'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {pinLock.hasPin ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => openPin('change')}>Ändern</Button>
                  <Button size="sm" variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={() => openPin('remove')}>Entfernen</Button>
                </>
              ) : (
                <Button size="sm" onClick={() => openPin('set')}>PIN einrichten</Button>
              )}
            </div>
          </div>

          {/* Auto-Lock */}
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Automatisch sperren</p>
                <p className="text-xs text-muted-foreground">Nach Inaktivität</p>
              </div>
            </div>
            <select
              disabled={!pinLock.hasPin}
              value={pinLock.lockTimeout}
              onChange={e => pinLock.setLockTimeout(Number(e.target.value))}
              className="text-sm rounded-md border border-input bg-background px-2 py-1.5 cursor-pointer disabled:opacity-40"
            >
              <option value={0}>Nie</option>
              <option value={30}>30 Sek.</option>
              <option value={60}>1 Min.</option>
              <option value={120}>2 Min.</option>
              <option value={300}>5 Min.</option>
              <option value={600}>10 Min.</option>
            </select>
          </div>

          {/* Screen-Off */}
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-2">
              <LockKeyholeOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Bildschirm ausschalten</p>
                <p className="text-xs text-muted-foreground">Display schwärzen</p>
              </div>
            </div>
            <select
              disabled={!pinLock.hasPin}
              value={pinLock.screenTimeout}
              onChange={e => pinLock.setScreenTimeout(Number(e.target.value))}
              className="text-sm rounded-md border border-input bg-background px-2 py-1.5 cursor-pointer disabled:opacity-40"
            >
              <option value={0}>Nie</option>
              <option value={30}>30 Sek.</option>
              <option value={60}>1 Min.</option>
              <option value={120}>2 Min.</option>
              <option value={300}>5 Min.</option>
            </select>
          </div>

          {/* Manuell sperren */}
          {pinLock.hasPin && (
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-medium">Jetzt sperren</p>
              <Button size="sm" variant="outline" onClick={pinLock.lock}>
                <LockKeyhole className="h-4 w-4 mr-1" /> Sperren
              </Button>
            </div>
          )}
        </div>
      </Section>

      {/* ── Wetter-Widget ──────────────────────────────────────────── */}      <DashboardWidgetsSection devices={devices} />      <WeatherSection />

      {/* ═══════════════════════════════════════════════════════════
          Dialoge
      ══════════════════════════════════════════════════════════ */}

      {/* ── Gerät-Dialog ──────────────────────────────────────────── */}
      <Dialog open={deviceDialog.open}
        onOpenChange={open => !open && setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '' })}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{deviceDialog.editing ? 'Gerät bearbeiten' : 'Neues Gerät'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            <Field label="Name" value={deviceDialog.form.name}
              onChange={v => patchDevice({ name: v })}
              placeholder="z.B. Deckenlampe"
              inputMode="text" autoComplete="off" />

            <div className="space-y-1">
              <label className="block text-sm font-medium">Typ</label>
              <Select value={deviceDialog.form.type}
                onValueChange={v => patchDevice({ type: v as DeviceType })}>
                <SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEVICE_TYPES.map(t => <SelectItem key={t} value={t}>{deviceLabels[t] ?? t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium">Raum</label>
              <Select value={deviceDialog.form.room_id}
                onValueChange={v => patchDevice({ room_id: v })}>
                <SelectTrigger className="h-11 text-base"><SelectValue placeholder="Raum wählen…" /></SelectTrigger>
                <SelectContent>
                  {rooms.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.icon} {r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium">Protokoll</label>
              <Select value={deviceDialog.form.mqtt_protocol}
                onValueChange={v => patchDevice({ mqtt_protocol: v as DeviceProtocol })}>
                <SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PROTOCOLS.find(p => p.value === proto)?.hint}
              </p>
            </div>

            {showTopic && (
              <Field
                label="MQTT Topic (Basis)"
                value={deviceDialog.form.mqtt_topic}
                onChange={v => patchDevice({ mqtt_topic: v })}
                placeholder={
                  proto === 'shelly_gen3' ? 'shellygen3/shellyplugsg3-XXXXXX'
                  : proto === 'shelly_gen1' ? 'shellies/shellyplug-s-XXXXXX'
                  : 'home/wohnzimmer/lampe'
                }
                hint="Geräte-ID steht in der Shelly-App unter Einstellungen → Geräteinformationen."
                inputMode="text" autoComplete="off"
              />
            )}

            {isHttp && (
              <Field
                label="IP-Adresse des Shelly"
                value={deviceDialog.form.mqtt_topic}
                onChange={v => patchDevice({ mqtt_topic: v })}
                placeholder="192.168.1.42"
                hint="IP aus der Shelly-App. Kein MQTT-Broker nötig — ideal für Raspberry Pi."
                type="text" inputMode="numeric" pattern="[0-9.]*"
              />
            )}

            {isBle && (
              <Field
                label="Bluetooth-Adresse (MAC, optional)"
                value={deviceDialog.form.ble_address}
                onChange={v => patchDevice({ ble_address: v })}
                placeholder="AA:BB:CC:DD:EE:FF"
                hint="Leer lassen für Browser-BLE (Gerät wird im Dialog ausgewählt). Für Pi BLE-Bridge: MAC aus der Shelly-App."
                inputMode="text" autoComplete="off"
              />
            )}

            <div className="flex items-center gap-3 py-1">
              <label className="text-sm font-medium flex-1">Aktiv</label>
              <input type="checkbox" className="h-5 w-5 rounded"
                checked={deviceDialog.form.active}
                onChange={e => patchDevice({ active: e.target.checked })} />
            </div>

            {deviceDialog.error && <p className="text-sm text-destructive">{deviceDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost"
              onClick={() => setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '' })}>
              Abbrechen
            </Button>
            <Button onClick={saveDevice} disabled={deviceDialog.saving}>
              {deviceDialog.saving ? 'Speichern…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Raum-Dialog ───────────────────────────────────────────── */}
      <Dialog open={roomDialog.open}
        onOpenChange={open => !open && setRoomDialog({ open: false, editing: undefined, name: '', icon: '🏠', saving: false, error: '' })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{roomDialog.editing ? 'Raum bearbeiten' : 'Neuer Raum'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Field label="Name" value={roomDialog.name}
              onChange={v => setRoomDialog(s => ({ ...s, name: v }))}
              placeholder="z.B. Wohnzimmer"
              inputMode="text" autoComplete="off" />

            <div className="space-y-1">
              <label className="block text-sm font-medium">Icon</label>
              <div className="flex gap-2 flex-wrap">
                {ROOM_ICONS.map(icon => (
                  <button key={icon}
                    onClick={() => setRoomDialog(s => ({ ...s, icon }))}
                    className={cn(
                      'cursor-pointer text-xl h-10 w-10 flex items-center justify-center rounded-lg border-2 transition-all',
                      roomDialog.icon === icon ? 'border-primary bg-primary/10' : 'border-transparent hover:border-muted bg-muted/40'
                    )}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {roomDialog.error && <p className="text-sm text-destructive">{roomDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost"
              onClick={() => setRoomDialog({ open: false, editing: undefined, name: '', icon: '🏠', saving: false, error: '' })}>
              Abbrechen
            </Button>
            <Button onClick={saveRoom} disabled={roomDialog.saving}>
              {roomDialog.saving ? 'Speichern…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PIN-Dialog ────────────────────────────────────────────── */}
      <Dialog open={pinDialog.open}
        onOpenChange={open => !open && setPinDialog(s => ({ ...s, open: false }))}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              {pinDialog.mode === 'set' && 'PIN einrichten'}
              {pinDialog.mode === 'change' && 'PIN ändern'}
              {pinDialog.mode === 'remove' && 'PIN entfernen'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(pinDialog.mode === 'change' || pinDialog.mode === 'remove') && (
              <Field label="Aktueller PIN" value={pinDialog.oldPin}
                onChange={v => setPinDialog(s => ({ ...s, oldPin: v.replace(/\D/g, '').slice(0, 4) }))}
                placeholder="••••" type="tel" inputMode="numeric" pattern="[0-9]*" autoComplete="current-password" />
            )}
            {pinDialog.mode !== 'remove' && (
              <>
                <Field label="Neuer PIN (4 Ziffern)" value={pinDialog.newPin}
                  onChange={v => setPinDialog(s => ({ ...s, newPin: v.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="••••" type="tel" inputMode="numeric" pattern="[0-9]*" autoComplete="new-password" />
                <Field label="PIN bestätigen" value={pinDialog.confirmPin}
                  onChange={v => setPinDialog(s => ({ ...s, confirmPin: v.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="••••" type="tel" inputMode="numeric" pattern="[0-9]*" autoComplete="new-password" />
              </>
            )}
            {pinDialog.error && <p className="text-sm text-destructive">{pinDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPinDialog(s => ({ ...s, open: false }))}>
              Abbrechen
            </Button>
            <Button onClick={savePin} disabled={pinDialog.saving}
              variant={pinDialog.mode === 'remove' ? 'destructive' : 'default'}>
              {pinDialog.mode === 'remove' ? 'Entfernen' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Löschen bestätigen ────────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => !open && setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              {deleteConfirm?.type === 'room' ? 'Raum löschen?' : 'Gerät löschen?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            <span className="font-medium">{deleteConfirm?.label}</span> wird dauerhaft gelöscht.
            {deleteConfirm?.type === 'room' && ' Alle zugehörigen Geräte werden ebenfalls entfernt.'}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={confirmDelete}>Löschen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
