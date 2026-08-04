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
  ChevronDown, Home, Cpu, Cloud, LayoutDashboard, Search, Loader2, Radio,
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

type DeviceProtocol = 'simple' | 'shelly_gen3' | 'shelly_gen1' | 'shelly_gen3_http' | 'bluetooth_shelly_gen3' | 'zigbee2mqtt';

// Vereinfachte Hersteller-Auswahl (ersetzt Protokoll-Dropdown für normale Nutzer)
const VENDOR_PRESETS: {
  id: string; label: string; icon: string; desc: string;
  protocol: DeviceProtocol; topicPrefix: string; topicPlaceholder: string; topicLabel: string;
  group?: string;
}[] = [
  { id: 'zigbee',        label: 'Zigbee',              icon: '📡', desc: 'SONOFF, NOUS, Aqara …',
    protocol: 'zigbee2mqtt',  topicPrefix: 'zigbee2mqtt/', topicPlaceholder: 'Wohnzimmer Steckdose', topicLabel: 'Gerätename (Zigbee2MQTT)' },
  { id: 'shelly_plugs3', label: 'Plug S Gen3',          icon: '🔶', desc: 'shellyplugsg3-…',
    protocol: 'shelly_gen3', topicPrefix: 'shellyplugsg3-', topicPlaceholder: '90706947XXXX', topicLabel: 'Geräte-MAC', group: 'shelly' },
  { id: 'shelly_plus1',  label: 'Plus 1 / 1PM',         icon: '🔶', desc: 'shellyplus1pm-…',
    protocol: 'shelly_gen3', topicPrefix: 'shellyplus1pm-', topicPlaceholder: 'XXXXXXXXXXXX', topicLabel: 'Geräte-MAC', group: 'shelly' },
  { id: 'shelly_plus2',  label: 'Plus 2PM',             icon: '🔶', desc: 'shellyplus2pm-…',
    protocol: 'shelly_gen3', topicPrefix: 'shellyplus2pm-', topicPlaceholder: 'XXXXXXXXXXXX', topicLabel: 'Geräte-MAC', group: 'shelly' },
  { id: 'shelly_other',  label: 'Anderes Shelly',       icon: '🔶', desc: 'Vollständige ID eingeben',
    protocol: 'shelly_gen3', topicPrefix: '', topicPlaceholder: 'shellyXXXX-XXXXXXXXXXXX', topicLabel: 'Geräte-ID', group: 'shelly' },
  { id: 'custom',        label: 'ESP32 / Sonstiges',    icon: '⚡', desc: 'Eigenes MQTT-Gerät',
    protocol: 'simple',      topicPrefix: '', topicPlaceholder: 'home/wohnzimmer/licht', topicLabel: 'MQTT Topic' },
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
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Eingabefeld mit festem Prefix (z.B. "zigbee2mqtt/") */
function PrefixField({
  label, prefix, value, onChange, placeholder, hint,
}: {
  label: string; prefix: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex rounded-lg border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
        <span className="flex items-center px-3 bg-muted text-muted-foreground text-sm border-r border-input whitespace-nowrap select-none">
          {prefix}
        </span>
        <input
          className="flex-1 bg-background px-3 py-2.5 text-base placeholder:text-muted-foreground focus:outline-none"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>
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
// Discovery
// ─────────────────────────────────────────────────────────────────

interface DiscoveredDevice {
  friendly_name: string;
  ieee_address: string | null;
  vendor: string | null;
  model: string | null;
  description: string | null;
  supported: boolean;
  device_type: DeviceType;
  mqtt_topic: string;
  protocol: DeviceProtocol;
  source: 'zigbee2mqtt' | 'shelly';
}

// ─────────────────────────────────────────────────────────────────
// Gerät-Formular-State
// ─────────────────────────────────────────────────────────────────

interface DeviceForm {
  name: string; type: DeviceType; room_id: string;
  mqtt_topic: string; mqtt_protocol: DeviceProtocol; ble_address: string; active: boolean;
  vendorId: string; // 'zigbee' | 'shelly' | 'custom' | '' (bei Discovery-Import)
}

const emptyDevice = (): DeviceForm => ({
  name: '', type: 'plug', room_id: '', mqtt_topic: '',
  mqtt_protocol: 'zigbee2mqtt', ble_address: '', active: true, vendorId: 'zigbee',
});

function deviceToForm(d: Device): DeviceForm {
  const proto = (d.attributes?.protocol as DeviceProtocol) ?? 'simple';
  const vendorId = proto === 'zigbee2mqtt' ? 'zigbee'
    : proto === 'shelly_gen3' || proto === 'shelly_gen1' || proto === 'shelly_gen3_http' || proto === 'bluetooth_shelly_gen3'
      ? (() => {
          // Shelly-Modell aus Topic ableiten
          const t = d.mqtt_topic ?? '';
          if (t.startsWith('shellyplugsg3-'))  return 'shelly_plugs3';
          if (t.startsWith('shellyplus1pm-'))  return 'shelly_plus1';
          if (t.startsWith('shellyplus2pm-'))  return 'shelly_plus2';
          return 'shelly_other';
        })()
    : 'custom';
  const vendor = VENDOR_PRESETS.find(v => v.id === vendorId);
  const fullTopic = d.mqtt_topic ?? '';
  const prefix = vendor?.topicPrefix ?? '';
  const displayTopic = prefix && fullTopic.startsWith(prefix)
    ? fullTopic.slice(prefix.length)
    : fullTopic;
  return {
    name: d.name, type: d.type, room_id: String(d.room_id),
    mqtt_topic: displayTopic,
    mqtt_protocol: proto,
    ble_address: (d.attributes?.ble_address as string) ?? '',
    active: d.active,
    vendorId,
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
    discovered: DiscoveredDevice[] | null; discovering: boolean; discoverError: string;
  }>({ open: false, form: emptyDevice(), saving: false, error: '', discovered: null, discovering: false, discoverError: '' });

  const openDevice = (d?: Device) => setDeviceDialog({
    open: true, editing: d, form: d ? deviceToForm(d) : emptyDevice(),
    saving: false, error: '', discovered: null, discovering: false, discoverError: '',
  });
  const patchDevice = (patch: Partial<DeviceForm>) =>
    setDeviceDialog(s => ({ ...s, form: { ...s.form, ...patch } }));

  const discoverZigbee = async () => {
    setDeviceDialog(s => ({ ...s, discovering: true, discoverError: '', discovered: null }));
    try {
      const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';
      const res = await fetch(`${BASE}/discover/all`, { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Fehler beim Suchen');
      }
      const list: DiscoveredDevice[] = await res.json();
      // Bereits hinzugefügte Geräte herausfiltern
      const existingTopics = new Set(devices.map(d => d.mqtt_topic));
      const fresh = list.filter(d => !existingTopics.has(d.mqtt_topic));
      setDeviceDialog(s => ({ ...s, discovering: false, discovered: fresh }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verbindung fehlgeschlagen';
      setDeviceDialog(s => ({ ...s, discovering: false, discoverError: msg }));
    }
  };

  const selectVendor = (vendorId: string) => {
    const preset = VENDOR_PRESETS.find(v => v.id === vendorId);
    if (!preset) return;
    patchDevice({ vendorId, mqtt_protocol: preset.protocol, mqtt_topic: '' });
  };

  const selectDiscovered = (d: DiscoveredDevice) => {
    const vendorId = d.source === 'zigbee2mqtt' ? 'zigbee' : d.source === 'shelly' ? 'shelly' : 'custom';
    const vendor = VENDOR_PRESETS.find(v => v.id === vendorId);
    const prefix = vendor?.topicPrefix ?? '';
    const displayTopic = prefix && d.mqtt_topic.startsWith(prefix)
      ? d.mqtt_topic.slice(prefix.length)
      : d.mqtt_topic;
    patchDevice({
      name: d.friendly_name,
      mqtt_topic: displayTopic,
      mqtt_protocol: d.protocol,
      type: d.device_type as DeviceType,
      vendorId: '',
    });
    setDeviceDialog(s => ({ ...s, discovered: null }));
  };

  const saveDevice = async () => {
    const { form, editing } = deviceDialog;
    if (!form.name.trim()) { setDeviceDialog(s => ({ ...s, error: 'Name ist erforderlich.' })); return; }
    if (!form.room_id)     { setDeviceDialog(s => ({ ...s, error: 'Bitte einen Raum wählen.' })); return; }
    setDeviceDialog(s => ({ ...s, saving: true, error: '' }));
    try {
      const attrs: Record<string, string> = { protocol: form.mqtt_protocol };
      if (form.ble_address.trim()) attrs.ble_address = form.ble_address.trim();

      // Prefix automatisch voranstellen (z.B. "zigbee2mqtt/" für Zigbee-Geräte)
      const vendor = VENDOR_PRESETS.find(v => v.id === form.vendorId);
      const prefix = vendor?.topicPrefix ?? '';
      const rawTopic = form.mqtt_topic.trim();
      const fullTopic = rawTopic
        ? (prefix && !rawTopic.startsWith(prefix) ? prefix + rawTopic : rawTopic)
        : null;
      const payload: Record<string, unknown> = {
        name: form.name.trim(), type: form.type, room_id: Number(form.room_id),
        active: form.active, attributes: attrs,
        mqtt_topic: fullTopic,
      };
      if (editing) {
        const updated = await api.updateDevice(editing.id, payload);
        setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
      } else {
        const created = await api.createDevice(payload);
        setDevices(prev => [...prev, created]);
      }
      setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '', discovered: null, discovering: false, discoverError: '' });
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
  const isZigbee  = proto === 'zigbee2mqtt';

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
        onOpenChange={open => !open && setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '', discovered: null, discovering: false, discoverError: '' })}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{deviceDialog.editing ? 'Gerät bearbeiten' : 'Neues Gerät'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            {/* ── Zigbee Discovery ──────────────────────────────── */}
            {!deviceDialog.editing && (
              <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Radio className="h-4 w-4 text-primary" />
                    Zigbee-Geräte suchen
                  </div>
                  <Button size="sm" variant="outline" onClick={discoverZigbee}
                    disabled={deviceDialog.discovering}>
                    {deviceDialog.discovering
                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Suche…</>
                      : <><Search className="h-3 w-3 mr-1" /> Suchen</>}
                  </Button>
                </div>

                {deviceDialog.discoverError && (
                  <p className="text-xs text-destructive">{deviceDialog.discoverError}</p>
                )}

                {deviceDialog.discovered !== null && deviceDialog.discovered.length === 0 && (
                  <p className="text-xs text-muted-foreground">Keine neuen Geräte gefunden.</p>
                )}

                {deviceDialog.discovered && deviceDialog.discovered.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {deviceDialog.discovered.map(d => (
                      <button key={d.ieee_address ?? d.mqtt_topic}
                        onClick={() => selectDiscovered(d)}
                        className="w-full text-left rounded-lg border bg-background px-3 py-2.5 hover:bg-accent transition-colors space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">{d.friendly_name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded font-medium',
                              d.source === 'zigbee2mqtt'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                            )}>
                              {d.source === 'zigbee2mqtt' ? 'Zigbee' : 'Shelly'}
                            </span>
                            {!d.supported && (
                              <span className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                                Experimentell
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {[d.vendor, d.model].filter(Boolean).join(' · ')}
                          {d.description ? ` — ${d.description}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Gerät antippen um das Formular automatisch auszufüllen.
                  Oder unten manuell eingeben.
                </p>
              </div>
            )}

            {/* ── Name ─────────────────────────────────────────── */}
            <Field label="Name" value={deviceDialog.form.name}
              onChange={v => patchDevice({ name: v })}
              placeholder="z.B. Wohnzimmer Steckdose"
              inputMode="text" autoComplete="off" />

            {/* ── Typ ──────────────────────────────────────────── */}
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

            {/* ── Raum ─────────────────────────────────────────── */}
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

            {/* ── Hersteller / Verbindung ───────────────────────── */}
            {!deviceDialog.editing && deviceDialog.form.vendorId !== '' && (() => {
              const isShelly = deviceDialog.form.vendorId.startsWith('shelly');
              const shellyModels = VENDOR_PRESETS.filter(v => v.group === 'shelly');
              const mainPresets  = VENDOR_PRESETS.filter(v => !v.group);
              return (
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Verbindung</label>
                  {/* Hauptkategorien */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'zigbee', label: 'Zigbee', icon: '📡', desc: 'SONOFF, NOUS …' },
                      { id: 'shelly_plugs3', label: 'Shelly', icon: '🔶', desc: 'Plug, Plus …' },
                      { id: 'custom', label: 'ESP32 / Sonst.', icon: '⚡', desc: 'Eigenes MQTT' },
                    ].map(v => (
                      <button key={v.id} type="button"
                        onClick={() => selectVendor(v.id)}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-xl border-2 py-3 px-2 text-center transition-all',
                          (v.id === 'shelly_plugs3' ? isShelly : deviceDialog.form.vendorId === v.id)
                            ? 'border-primary bg-primary/10'
                            : 'border-transparent bg-muted/40 hover:border-muted-foreground/30'
                        )}>
                        <span className="text-2xl">{v.icon}</span>
                        <span className="text-xs font-semibold leading-tight">{v.label}</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">{v.desc}</span>
                      </button>
                    ))}
                  </div>
                  {/* Shelly-Modellauswahl */}
                  {isShelly && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {shellyModels.map(m => (
                        <button key={m.id} type="button"
                          onClick={() => selectVendor(m.id)}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left transition-all',
                            deviceDialog.form.vendorId === m.id
                              ? 'border-primary bg-primary/10'
                              : 'border-transparent bg-muted/40 hover:border-muted-foreground/30'
                          )}>
                          <span className="text-base shrink-0">{m.icon}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{m.label}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{m.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Topic ─────────────────────────────────────────── */}
            {(() => {
              const vendor = VENDOR_PRESETS.find(v => v.id === deviceDialog.form.vendorId);
              const proto  = deviceDialog.form.mqtt_protocol;
              if (proto === 'bluetooth_shelly_gen3') return (
                <Field label="Bluetooth-Adresse (MAC, optional)"
                  value={deviceDialog.form.ble_address}
                  onChange={v => patchDevice({ ble_address: v })}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  hint="Leer lassen für Browser-BLE. Für Pi BLE-Bridge: MAC aus der Shelly-App."
                  inputMode="text" autoComplete="off" />
              );
              if (proto === 'shelly_gen3_http') return (
                <Field label="IP-Adresse des Shelly"
                  value={deviceDialog.form.mqtt_topic}
                  onChange={v => patchDevice({ mqtt_topic: v })}
                  placeholder="192.168.1.42"
                  hint="IP aus der Shelly-App — kein MQTT-Broker nötig."
                  type="text" inputMode="numeric" />
              );
              if (vendor?.topicPrefix) return (
                <PrefixField
                  label={vendor.topicLabel}
                  prefix={vendor.topicPrefix}
                  value={deviceDialog.form.mqtt_topic}
                  onChange={v => patchDevice({ mqtt_topic: v })}
                  placeholder={vendor.topicPlaceholder}
                  hint="Name exakt wie in Zigbee2MQTT — oder oben auf Suchen klicken." />
              );
              return (
                <Field
                  label={vendor?.topicLabel ?? 'MQTT Topic'}
                  value={deviceDialog.form.mqtt_topic}
                  onChange={v => patchDevice({ mqtt_topic: v })}
                  placeholder={vendor?.topicPlaceholder ?? 'home/wohnzimmer/licht'}
                  hint={
                    deviceDialog.form.vendorId === 'shelly'
                      ? 'Geräte-ID aus der Shelly-App (Einstellungen → Geräteinformationen).'
                      : 'MQTT-Topic das dein Gerät verwendet.'
                  }
                  inputMode="text" autoComplete="off" />
              );
            })()}

            {/* ── Aktiv ─────────────────────────────────────────── */}
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
              onClick={() => setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '', discovered: null, discovering: false, discoverError: '' })}>
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
