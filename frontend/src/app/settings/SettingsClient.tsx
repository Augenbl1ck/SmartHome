'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { api, Device, DeviceType, Room, ZigbeeDevice } from '@/lib/api';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { deviceLabels, CUSTOM_COLORS } from '@/lib/devices';
import { getEcho } from '@/lib/echo';
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
  ChevronUp, X, ChevronRight, ArrowLeft, Clapperboard, Zap, Monitor, RefreshCw, Check, Bell, Activity,
  Eye, EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import { usePinLockContext } from '@/components/PinLockProvider';
import { useKiosk } from '@/components/KioskProvider';
import EmojiPicker from '@/components/EmojiPicker';
import { cn } from '@/lib/utils';
import { saveDashboardLayout, DASHBOARD_LAYOUT_KEY, type SectionId } from '@/hooks/useDashboardLayout';

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

/** Sektion — optional ohne Ausklapp-Toggle (alwaysOpen=true) */
function Section({
  title, icon: Icon, badge, children, defaultOpen = false, alwaysOpen = false,
}: {
  title: string; icon: React.ElementType; badge?: number | string;
  children: React.ReactNode; defaultOpen?: boolean; alwaysOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (alwaysOpen) {
    return <div className="rounded-xl border bg-card overflow-hidden">{children}</div>;
  }
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
  mqtt_topic: string; mqtt_protocol: DeviceProtocol; ble_address: string; shelly_ip: string; active: boolean;
  vendorId: string;
  custom_emoji: string;
  custom_color: string;
}

const emptyDevice = (): DeviceForm => ({
  name: '', type: 'plug', room_id: '', mqtt_topic: '',
  mqtt_protocol: 'zigbee2mqtt', ble_address: '', shelly_ip: '', active: true, vendorId: 'zigbee',
  custom_emoji: '', custom_color: '',
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
    shelly_ip: (d.attributes?.shelly_ip as string) ?? '',
    active: d.active,
    vendorId,
    custom_emoji: (d.attributes?.custom_emoji as string) ?? '',
    custom_color: (d.attributes?.custom_color as string) ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────
// Hauptkomponente
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Dashboard-Widget-Einstellungen (localStorage)
// ─────────────────────────────────────────────────────────────────

const WIDGETS_KEY = 'smarthome_dashboard_widgets';

const SECTION_LABELS: Record<string, string> = {
  scenes: 'Szenen',
  rooms: 'Räume',
  quickaccess: 'Schnellzugriff',
};

function DashboardWidgetsSection({ devices, rooms }: { devices: Device[]; rooms: Room[] }) {
  // ── Abschnitte & Räume-Reihenfolge (auto-save) ──
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(['scenes', 'rooms', 'quickaccess']);
  const [hiddenSections, setHiddenSections] = useState<SectionId[]>([]);
  const [roomOrder, setRoomOrder] = useState<number[]>([]);

  // ── Status-Kacheln (manuell speichern) ──
  const [selected, setSelected] = useState<number[]>([]);
  const [widgetSaved, setWidgetSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WIDGETS_KEY);
      if (raw) setSelected(JSON.parse(raw));
    } catch { /* */ }
    try {
      const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
      if (raw) {
        const l = JSON.parse(raw);
        if (Array.isArray(l.sectionOrder)) setSectionOrder(l.sectionOrder);
        if (Array.isArray(l.hiddenSections)) setHiddenSections(l.hiddenSections);
        if (Array.isArray(l.roomOrder)) setRoomOrder(l.roomOrder);
      }
    } catch { /* */ }
  }, []);

  const persistLayout = (so: SectionId[], hs: SectionId[], ro: number[]) =>
    saveDashboardLayout({ sectionOrder: so, hiddenSections: hs, roomOrder: ro });

  // ── Section helpers ──
  const toggleSection = (id: SectionId) => {
    const next = hiddenSections.includes(id)
      ? hiddenSections.filter(s => s !== id)
      : [...hiddenSections, id];
    setHiddenSections(next);
    persistLayout(sectionOrder, next, roomOrder);
  };
  const moveSectionUp = (i: number) => {
    if (i === 0) return;
    const next = [...sectionOrder];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setSectionOrder(next);
    persistLayout(next, hiddenSections, roomOrder);
  };
  const moveSectionDown = (i: number) => {
    if (i >= sectionOrder.length - 1) return;
    const next = [...sectionOrder];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setSectionOrder(next);
    persistLayout(next, hiddenSections, roomOrder);
  };

  // ── Room order helpers ──
  const orderedRooms = roomOrder.length === 0
    ? rooms
    : rooms.slice().sort((a, b) => {
        const ai = roomOrder.indexOf(a.id);
        const bi = roomOrder.indexOf(b.id);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

  const moveRoomUp = (i: number) => {
    if (i === 0) return;
    const ids = orderedRooms.map(r => r.id);
    [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    setRoomOrder(ids);
    persistLayout(sectionOrder, hiddenSections, ids);
  };
  const moveRoomDown = (i: number) => {
    if (i >= orderedRooms.length - 1) return;
    const ids = orderedRooms.map(r => r.id);
    [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
    setRoomOrder(ids);
    persistLayout(sectionOrder, hiddenSections, ids);
  };

  // ── Widget helpers ──
  const add    = (id: number) => setSelected(prev => prev.includes(id) || prev.length >= 2 ? prev : [...prev, id]);
  const remove = (id: number) => setSelected(prev => prev.filter(x => x !== id));
  const moveUp = (i: number) => setSelected(prev => {
    if (i === 0) return prev;
    const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next;
  });
  const moveDown = (i: number) => setSelected(prev => {
    if (i >= prev.length - 1) return prev;
    const next = [...prev]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next;
  });
  const saveWidgets = () => {
    localStorage.setItem(WIDGETS_KEY, JSON.stringify(selected));
    window.dispatchEvent(new StorageEvent('storage', { key: WIDGETS_KEY }));
    setWidgetSaved(true);
    setTimeout(() => setWidgetSaved(false), 2000);
  };
  const resetWidgets = () => {
    setSelected([]);
    localStorage.removeItem(WIDGETS_KEY);
    setWidgetSaved(true);
    setTimeout(() => setWidgetSaved(false), 2000);
  };
  const available = devices.filter(d => !selected.includes(d.id));

  return (
    <div className="space-y-6">

      {/* ── Abschnitte ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Abschnitte</p>
        <p className="text-xs text-muted-foreground mb-3">Ein-/Ausblenden und Reihenfolge der Dashboard-Bereiche.</p>
        <div className="space-y-1">
          {sectionOrder.map((id, i) => {
            const isHidden = hiddenSections.includes(id);
            return (
              <div key={id} className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 transition-opacity',
                isHidden ? 'opacity-50' : '',
              )}>
                <button onClick={() => toggleSection(id)}
                  title={isHidden ? 'Einblenden' : 'Ausblenden'}
                  className={cn(
                    'cursor-pointer h-7 w-7 rounded flex items-center justify-center shrink-0 transition-colors',
                    isHidden
                      ? 'bg-muted text-muted-foreground hover:bg-accent'
                      : 'bg-primary/15 text-primary hover:bg-primary/25',
                  )}>
                  {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <span className="text-sm flex-1">{SECTION_LABELS[id]}</span>
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => moveSectionUp(i)} disabled={i === 0}
                    className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => moveSectionDown(i)} disabled={i === sectionOrder.length - 1}
                    className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Räume-Reihenfolge ── */}
      {rooms.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Räume-Reihenfolge</p>
          <p className="text-xs text-muted-foreground mb-3">Reihenfolge der Raum-Kacheln auf dem Dashboard.</p>
          <div className="space-y-1">
            {orderedRooms.map((room, i) => (
              <div key={room.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className="text-base select-none w-6 text-center">{room.icon ?? '🏠'}</span>
                <span className="text-sm flex-1 truncate">{room.name}</span>
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => moveRoomUp(i)} disabled={i === 0}
                    className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => moveRoomDown(i)} disabled={i === orderedRooms.length - 1}
                    className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Status-Kacheln ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Status-Kacheln</p>
        <p className="text-xs text-muted-foreground mb-3">
          Bis zu <strong>2 Geräte</strong> als Schnellzugriff-Kacheln anzeigen.
        </p>

        {selected.length > 0 && (
          <div className="space-y-1 mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ausgewählt</p>
            {selected.map((id, i) => {
              const d = devices.find(x => x.id === id);
              if (!d) return null;
              return (
                <div key={id} className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1.5">
                  <span className="text-xs font-bold text-primary w-4 shrink-0">{i + 1}</span>
                  <span className="text-sm flex-1 truncate">{d.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{d.type.replace('sensor_', '')}</span>
                  <div className="flex gap-0.5 shrink-0">
                    <button onClick={() => moveUp(i)} disabled={i === 0}
                      className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => moveDown(i)} disabled={i === selected.length - 1}
                      className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(id)}
                      className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selected.length < 2 && available.length > 0 && (
          <div className="space-y-1 mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hinzufügen</p>
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {available.map(d => (
                <button key={d.id} onClick={() => add(d.id)}
                  className="cursor-pointer w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-accent transition-colors">
                  <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate">{d.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{d.type.replace('sensor_', '')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {devices.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Keine Geräte vorhanden.</p>
        )}

        <p className="text-[11px] text-muted-foreground mb-2">{selected.length}/2 ausgewählt</p>
        <div className="flex gap-2">
          <Button onClick={saveWidgets} size="sm">{widgetSaved ? '✓ Gespeichert' : 'Speichern'}</Button>
          {selected.length > 0 && (
            <Button onClick={resetWidgets} size="sm" variant="outline">Zurücksetzen</Button>
          )}
        </div>
      </div>

    </div>
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
    <div className="divide-y rounded-2xl border bg-card overflow-hidden">
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
  );
}

// ─────────────────────────────────────────────────────────────────
// Zigbee-Verwaltung
// ─────────────────────────────────────────────────────────────────

function ZigbeeSection({ rooms, onDeviceImported }: { rooms: Room[]; onDeviceImported: (d: Device) => void }) {
  const [zbDevices, setZbDevices] = useState<ZigbeeDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairCountdown, setPairCountdown] = useState(0);

  const [importDialog, setImportDialog] = useState<{ open: boolean; device?: ZigbeeDevice; name: string; type: DeviceType; room_id: string; saving: boolean; err: string }>({
    open: false, name: '', type: 'plug', room_id: '', saving: false, err: '',
  });
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; device?: ZigbeeDevice; name: string; saving: boolean; err: string }>({
    open: false, name: '', saving: false, err: '',
  });
  const [removeConfirm, setRemoveConfirm] = useState<ZigbeeDevice | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const list = await api.getZigbeeDevices();
      setZbDevices(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-Refresh: Alle 10s während Pairing, sonst alle 30s
  useEffect(() => {
    const interval = setInterval(load, pairing ? 10_000 : 30_000);
    return () => clearInterval(interval);
  }, [load, pairing]);

  useEffect(() => {
    if (!pairing || pairCountdown <= 0) return;
    const t = setTimeout(() => setPairCountdown(c => {
      if (c <= 1) { setPairing(false); return 0; }
      return c - 1;
    }), 1000);
    return () => clearTimeout(t);
  }, [pairing, pairCountdown]);

  const togglePairing = async () => {
    try {
      if (pairing) {
        await api.zigbeePermitJoin(false);
        setPairing(false); setPairCountdown(0);
      } else {
        await api.zigbeePermitJoin(true, 120);
        setPairing(true); setPairCountdown(120);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const doImport = async () => {
    const { device, name, type, room_id } = importDialog;
    if (!device) return;
    if (!name.trim()) { setImportDialog(s => ({ ...s, err: 'Name erforderlich' })); return; }
    if (!room_id) { setImportDialog(s => ({ ...s, err: 'Raum wählen' })); return; }
    setImportDialog(s => ({ ...s, saving: true, err: '' }));
    try {
      const created = await api.zigbeeImport(device.ieee_address, device.friendly_name, { name: name.trim(), type, room_id: Number(room_id) });
      onDeviceImported(created);
      setZbDevices(prev => prev.map(d => d.ieee_address === device.ieee_address ? { ...d, smarthome_device: created } : d));
      setImportDialog({ open: false, name: '', type: 'plug', room_id: '', saving: false, err: '' });
    } catch (e) {
      setImportDialog(s => ({ ...s, saving: false, err: e instanceof Error ? e.message : 'Fehler' }));
    }
  };

  const doRename = async () => {
    const { device, name } = renameDialog;
    if (!device || !name.trim()) return;
    setRenameDialog(s => ({ ...s, saving: true, err: '' }));
    try {
      await api.zigbeeRename(device.ieee_address, name.trim());
      setZbDevices(prev => prev.map(d => d.ieee_address === device.ieee_address ? { ...d, friendly_name: name.trim() } : d));
      setRenameDialog({ open: false, name: '', saving: false, err: '' });
    } catch (e) {
      setRenameDialog(s => ({ ...s, saving: false, err: e instanceof Error ? e.message : 'Fehler' }));
    }
  };

  const doRemove = async () => {
    if (!removeConfirm) return;
    try {
      await api.zigbeeRemove(removeConfirm.ieee_address);
      setZbDevices(prev => prev.filter(d => d.ieee_address !== removeConfirm.ieee_address));
      setRemoveConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setRemoveConfirm(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Pairing */}
      <div className="rounded-xl border bg-card px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm">Gerät anlernen</p>
          <p className="text-xs text-muted-foreground">
            {pairing ? `Pairing aktiv — ${pairCountdown}s` : 'Neues Zigbee-Gerät in den Pairing-Modus versetzen'}
          </p>
        </div>
        <Button size="sm" variant={pairing ? 'destructive' : 'default'} onClick={togglePairing}>
          {pairing ? 'Stoppen' : 'Pairing starten'}
        </Button>
      </div>

      {/* Geräteliste */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Zigbee-Geräte ({zbDevices.length})</p>
        <button onClick={load} disabled={loading}
          className="cursor-pointer h-7 w-7 flex items-center justify-center rounded hover:bg-accent">
          <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', loading && 'animate-spin')} />
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && zbDevices.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />Lade…</p>
      )}

      {!loading && zbDevices.length === 0 && !error && (
        <p className="text-sm text-muted-foreground text-center py-4">Keine Zigbee-Geräte gefunden.</p>
      )}

      <div className="space-y-2">
        {zbDevices.map(dev => (
          <div key={dev.ieee_address} className="rounded-xl border bg-card px-3 py-2.5 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-medium text-sm truncate">{dev.friendly_name}</p>
                  {!dev.supported && (
                    <span className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 rounded">Experimentell</span>
                  )}
                  {dev.smarthome_device && (
                    <span className="flex items-center gap-0.5 text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">
                      <Check className="h-2.5 w-2.5" />Importiert
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {dev.definition?.vendor} {dev.definition?.model}
                  {dev.definition?.description ? ` — ${dev.definition.description}` : ''}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{dev.ieee_address}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {!dev.smarthome_device && (
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setImportDialog({ open: true, device: dev, name: dev.friendly_name, type: 'plug', room_id: '', saving: false, err: '' })}>
                    Importieren
                  </Button>
                )}
                <button onClick={() => setRenameDialog({ open: true, device: dev, name: dev.friendly_name, saving: false, err: '' })}
                  className="cursor-pointer h-7 w-7 flex items-center justify-center rounded hover:bg-accent">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => setRemoveConfirm(dev)}
                  className="cursor-pointer h-7 w-7 flex items-center justify-center rounded hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Import Dialog */}
      <Dialog open={importDialog.open} onOpenChange={open => !open && setImportDialog(s => ({ ...s, open: false }))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Gerät importieren</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Field label="Name" value={importDialog.name} onChange={v => setImportDialog(s => ({ ...s, name: v }))} placeholder="z.B. Stehlampe" />
            <div className="space-y-1">
              <label className="block text-sm font-medium">Typ</label>
              <select value={importDialog.type} onChange={e => setImportDialog(s => ({ ...s, type: e.target.value as DeviceType }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm">
                {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium">Raum</label>
              <select value={importDialog.room_id} onChange={e => setImportDialog(s => ({ ...s, room_id: e.target.value }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm">
                <option value="">Raum wählen…</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
              </select>
            </div>
            {importDialog.err && <p className="text-sm text-destructive">{importDialog.err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportDialog(s => ({ ...s, open: false }))}>Abbrechen</Button>
            <Button onClick={doImport} disabled={importDialog.saving}>
              {importDialog.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Importieren'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Umbenennen Dialog */}
      <Dialog open={renameDialog.open} onOpenChange={open => !open && setRenameDialog(s => ({ ...s, open: false }))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Gerät umbenennen</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Field label="Neuer Name" value={renameDialog.name} onChange={v => setRenameDialog(s => ({ ...s, name: v }))} />
            {renameDialog.err && <p className="text-sm text-destructive">{renameDialog.err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameDialog(s => ({ ...s, open: false }))}>Abbrechen</Button>
            <Button onClick={doRename} disabled={renameDialog.saving}>
              {renameDialog.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Entfernen bestätigen */}
      <Dialog open={!!removeConfirm} onOpenChange={open => !open && setRemoveConfirm(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Gerät entfernen?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            <span className="font-medium">{removeConfirm?.friendly_name}</span> wird aus Zigbee2MQTT entfernt.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveConfirm(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={doRemove}>Entfernen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotificationsSection() {
  const { state, subscribe, unsubscribe, sendTest } = usePushNotifications();
  const [testSent, setTestSent] = useState(false);

  const handleTest = async () => {
    await sendTest();
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  };

  return (
    <div className="rounded-2xl border bg-card divide-y overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div>
          <p className="text-sm font-medium">Push-Benachrichtigungen</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {state === 'unsupported' && 'Nicht unterstützt (HTTPS oder PWA benötigt)'}
            {state === 'denied'      && 'Vom Browser blockiert — in Browser-Einstellungen erlauben'}
            {state === 'subscribed'  && 'Aktiv — dieses Gerät erhält Benachrichtigungen'}
            {state === 'unsubscribed'&& 'Deaktiviert'}
            {state === 'loading'     && 'Wird geladen…'}
          </p>
        </div>
        <div className="shrink-0">
          {state === 'subscribed' ? (
            <Button size="sm" variant="outline"
              className="text-destructive border-destructive/40"
              onClick={unsubscribe}>Deaktivieren</Button>
          ) : state === 'unsubscribed' ? (
            <Button size="sm" onClick={subscribe}>Aktivieren</Button>
          ) : null}
        </div>
      </div>
      {state === 'subscribed' && (
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div>
            <p className="text-sm font-medium">Testbenachrichtigung</p>
            <p className="text-xs text-muted-foreground">Sendet eine Test-Push an dieses Gerät</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleTest}>
            {testSent ? '✓ Gesendet' : 'Test senden'}
          </Button>
        </div>
      )}
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Benachrichtigungen werden ausgelöst wenn eine Automation mit Aktion „Benachrichtigung" ausgelöst wird.
          Jedes Gerät muss separat aktiviert werden.
        </p>
      </div>
    </div>
  );
}

function KioskSection() {
  const { kioskMode, setKioskMode } = useKiosk();
  return (
    <div className="rounded-2xl border bg-card px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Vollbild-Modus für Wandbildschirme. Versteckt die Navigationsleiste und
          zeigt stattdessen eine Room-Schnellleiste unten. Nach 5 Min. Inaktivität
          erscheint ein Bildschirmschoner mit großer Uhr.
        </p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Kiosk-Modus aktiv</p>
            <p className="text-xs text-muted-foreground">
              {kioskMode ? 'Aktiv — Bottom-Bar sichtbar' : 'Deaktiviert'}
            </p>
          </div>
          <input
            type="checkbox"
            checked={kioskMode}
            onChange={e => setKioskMode(e.target.checked)}
            className="h-5 w-5 rounded accent-primary cursor-pointer"
          />
        </div>
    </div>
  );
}

function SystemSection() {
  const [status, setStatus] = useState<{
    cpu_temp: number | null;
    uptime: number | null;
    memory_used: number | null;
    disk_used: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStatus = useCallback(() => {
    api.getSystemStatus()
      .then(data => {
        setStatus(data);
        setLastUpdate(new Date());
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  // Initialer Load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-Refresh alle 5 Sekunden
  useEffect(() => {
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const formatUptime = (seconds: number | null): string => {
    if (!seconds) return '—';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatLastUpdate = () => {
    if (!lastUpdate) return '';
    const now = new Date();
    const diff = Math.floor((now.getTime() - lastUpdate.getTime()) / 1000);
    if (diff < 5) return 'gerade eben';
    if (diff < 60) return `vor ${diff}s`;
    return lastUpdate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="rounded-2xl border bg-card divide-y overflow-hidden">
      {/* Header mit Refresh-Button */}
      {!loading && status && (
        <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Aktualisiert {formatLastUpdate()}
          </p>
          <button
            onClick={fetchStatus}
            className="cursor-pointer flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Aktualisieren
          </button>
        </div>
      )}

      {loading && (
        <div className="px-4 py-8 flex flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Lade System-Status...</p>
        </div>
      )}

      {!loading && !status && (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">System-Status nicht verfügbar</p>
          <p className="text-xs text-muted-foreground mt-1">Nur auf Raspberry Pi verfügbar</p>
        </div>
      )}

      {!loading && status && (
        <>
          {/* CPU-Temperatur */}
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">CPU-Temperatur</p>
                <p className="text-xs text-muted-foreground">Raspberry Pi</p>
              </div>
            </div>
            <div className="text-right">
              {status.cpu_temp !== null ? (
                <p className={cn(
                  'text-lg font-semibold',
                  status.cpu_temp > 70 ? 'text-red-500' : status.cpu_temp > 60 ? 'text-orange-500' : 'text-green-500'
                )}>
                  {status.cpu_temp}°C
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {/* Uptime */}
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div>
              <p className="text-sm font-medium">Betriebszeit</p>
              <p className="text-xs text-muted-foreground">Seit letztem Neustart</p>
            </div>
            <p className="text-sm font-medium">{formatUptime(status.uptime)}</p>
          </div>

          {/* RAM */}
          {status.memory_used !== null && (
            <div className="flex items-center justify-between px-4 py-3 gap-3">
              <div>
                <p className="text-sm font-medium">RAM-Nutzung</p>
              </div>
              <p className={cn(
                'text-sm font-medium',
                status.memory_used > 85 ? 'text-red-500' : status.memory_used > 70 ? 'text-orange-500' : ''
              )}>
                {status.memory_used}%
              </p>
            </div>
          )}

          {/* Disk */}
          {status.disk_used !== null && (
            <div className="flex items-center justify-between px-4 py-3 gap-3">
              <div>
                <p className="text-sm font-medium">Speicher</p>
                <p className="text-xs text-muted-foreground">Root-Partition</p>
              </div>
              <p className={cn(
                'text-sm font-medium',
                status.disk_used > 90 ? 'text-red-500' : status.disk_used > 80 ? 'text-orange-500' : ''
              )}>
                {status.disk_used}%
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SettingsClient({ initialRooms, initialDevices }: Props) {
  const [rooms, setRooms]     = useState(initialRooms);
  const [devices, setDevices] = useState(initialDevices);
  const pinLock = usePinLockContext();
  const [view, setView] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const navigate = (target: string | null) =>
    startTransition(() => setView(target));

  // WebSocket-Updates für Geräte (Status, Attribute, last_seen)
  useEffect(() => {
    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('devices').listen('.device.updated', (data: {
        id: number; status: string; attributes: Record<string, unknown>; last_seen: string;
      }) => {
        setDevices(prev => prev.map(d => d.id === data.id
          ? { ...d, status: data.status, attributes: data.attributes, last_seen: data.last_seen }
          : d
        ));
      });
    } catch (err) {
      console.warn('[Settings] WebSocket nicht verfügbar', err);
    }
    return () => {
      if (echo) echo.leaveChannel('devices');
    };
  }, []);

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
  const attrs: Record<string, unknown> = { protocol: form.mqtt_protocol };
      if (form.ble_address.trim()) attrs.ble_address = form.ble_address.trim();
      if (form.shelly_ip.trim())   attrs.shelly_ip   = form.shelly_ip.trim();
      if (form.custom_emoji.trim()) attrs.custom_emoji = form.custom_emoji.trim();
      if (form.custom_color) attrs.custom_color = form.custom_color;
      // Laufzeit-Attribute (power_w, temperature usw.) erhalten
      const existingAttrs = (deviceDialog.editing?.attributes ?? {}) as Record<string, unknown>;
      const runtimeKeys = ['power_w', 'energy_wh', 'temperature', 'humidity', 'battery',
        'on_since', 'on_duration_fired', 'local_temperature', 'setpoint'];
      for (const k of runtimeKeys) {
        if (existingAttrs[k] !== undefined) attrs[k] = existingAttrs[k];
      }

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

  const CATEGORIES = [
    { id: 'devices',  icon: Cpu,          color: 'text-blue-500   bg-blue-500/10',   label: 'Ger\u00e4te',           desc: `${devices.length} Ger\u00e4t${devices.length !== 1 ? 'e' : ''}` },
    { id: 'rooms',    icon: Home,         color: 'text-violet-500 bg-violet-500/10', label: 'R\u00e4ume',            desc: `${rooms.length} Raum/${rooms.length !== 1 ? 'R\u00e4ume' : ''}` },
    { id: 'scenes',   icon: Clapperboard, color: 'text-amber-500  bg-amber-500/10',  label: 'Szenen',           desc: 'Szenen verwalten',         href: '/scenes' },
    { id: 'automat',  icon: Zap,          color: 'text-green-500  bg-green-500/10',  label: 'Automationen',     desc: 'Regeln & Zeitpl\u00e4ne',        href: '/automations' },
    { id: 'dashboard',icon: LayoutDashboard, color: 'text-indigo-500 bg-indigo-500/10',label: 'Dashboard',      desc: 'Abschnitte & Räume anordnen' },
    { id: 'weather',  icon: Cloud,        color: 'text-sky-500    bg-sky-500/10',    label: 'Wetter-Widget',    desc: 'Ort & Einheiten' },
    { id: 'system',   icon: Activity,     color: 'text-emerald-500 bg-emerald-500/10', label: 'System',         desc: 'CPU-Temp & Status' },
    { id: 'security', icon: LockKeyhole,  color: 'text-orange-500 bg-orange-500/10', label: 'Sicherheit',       desc: 'PIN & Bildschirmsperre' },
    { id: 'kiosk',    icon: Monitor,      color: 'text-teal-500   bg-teal-500/10',   label: 'Kiosk-Modus',      desc: 'Wandbildschirm einrichten' },
    { id: 'zigbee',   icon: Radio,        color: 'text-cyan-500   bg-cyan-500/10',   label: 'Zigbee',           desc: 'Geräte anlernen & verwalten' },
    { id: 'notifs',   icon: Bell,         color: 'text-rose-500   bg-rose-500/10',   label: 'Benachrichtigungen', desc: 'Push-Nachrichten' },
  ];
  const viewLabel = CATEGORIES.find(c => c.id === view)?.label ?? view;

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        {view && (
          <button onClick={() => navigate(null)}
            className="cursor-pointer h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-all">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="text-xl font-bold">{view ? viewLabel : 'Einstellungen'}</h1>
      </div>

      {/* ── Kategorien-Übersicht ──────────────────────────────────── */}
      {!view && (
        <div key="main" className="grid grid-cols-2 gap-3 sm:grid-cols-4 animate-page-in">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const [textCls, bgCls] = cat.color.trim().split(/\s+/);
            const inner = (
              <>
                <div className={cn('h-14 w-14 rounded-2xl flex items-center justify-center mb-2', bgCls)}>
                  <Icon className={cn('h-7 w-7', textCls)} />
                </div>
                <p className="font-semibold text-sm leading-tight">{cat.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{cat.desc}</p>
              </>
            );
            if ('href' in cat && cat.href) {
              return (
                <Link key={cat.id} href={cat.href}
                  className="flex flex-col items-center text-center rounded-2xl border bg-card p-4 transition-all active:scale-[0.97] hover:bg-accent/50">
                  {inner}
                </Link>
              );
            }
            return (
              <button key={cat.id} onClick={() => navigate(cat.id)}
                className="cursor-pointer flex flex-col items-center text-center rounded-2xl border bg-card p-4 transition-all active:scale-[0.97] hover:bg-accent/50">
                {inner}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Geräte ────────────────────────────────────────────────── */}
      {view === 'devices' && (
        <div key="devices" className="animate-page-in space-y-3">
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
      )}

      {/* ── Räume ─────────────────────────────────────────────────── */}
      {view === 'rooms' && (
        <div key="rooms" className="animate-page-in space-y-3">
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
      )}

      {/* ── PIN & Sicherheit ──────────────────────────────────────── */}
      {view === 'security' && (
        <div key="security" className="animate-page-in divide-y rounded-2xl border bg-card overflow-hidden">

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
      )}

      {view === 'dashboard' && <div key="dashboard" className="animate-page-in"><DashboardWidgetsSection devices={devices} rooms={rooms} /></div>}
      {view === 'weather'   && <div key="weather"   className="animate-page-in"><WeatherSection /></div>}
      {view === 'system'    && <div key="system"    className="animate-page-in"><SystemSection /></div>}
      {view === 'kiosk'     && <div key="kiosk"     className="animate-page-in"><KioskSection /></div>}
      {view === 'zigbee'    && <div key="zigbee"    className="animate-page-in"><ZigbeeSection rooms={rooms} onDeviceImported={d => setDevices(prev => [...prev, d])} /></div>}
      {view === 'notifs'    && <div key="notifs"    className="animate-page-in"><NotificationsSection /></div>}

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
              if (proto === 'shelly_gen3' || proto === 'shelly_gen1') return (
                <>
                  {vendor?.topicPrefix ? (
                    <PrefixField
                      label={vendor.topicLabel}
                      prefix={vendor.topicPrefix}
                      value={deviceDialog.form.mqtt_topic}
                      onChange={v => patchDevice({ mqtt_topic: v })}
                      placeholder={vendor.topicPlaceholder}
                      hint="Aus der Shelly-App (Gerätename ohne Prefix)." />
                  ) : (
                    <Field label="Geräte-ID"
                      value={deviceDialog.form.mqtt_topic}
                      onChange={v => patchDevice({ mqtt_topic: v })}
                      placeholder="shellyXXXX-XXXXXXXXXXXX" />
                  )}
                  <Field label="Shelly IP (für LED-Ring & Einstellungen, optional)"
                    value={deviceDialog.form.shelly_ip}
                    onChange={v => patchDevice({ shelly_ip: v })}
                    placeholder="192.168.1.xx"
                    hint="IP aus der Shelly-App. Wird für direkten Zugriff auf LED-Ring und Konfiguration benötigt."
                    inputMode="numeric" autoComplete="off" />
                </>
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

            {/* ── Anzeige (Emoji + Farbe) ────────────────────────── */}
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Anzeige (optional)</p>
              <div className="space-y-1">
                <label className="text-sm font-medium">Emoji-Icon</label>
                <EmojiPicker
                  value={deviceDialog.form.custom_emoji}
                  onChange={v => patchDevice({ custom_emoji: v })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Farbe</label>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => patchDevice({ custom_color: '' })}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 bg-muted flex items-center justify-center text-[10px] text-muted-foreground',
                      !deviceDialog.form.custom_color ? 'border-primary ring-1 ring-primary' : 'border-transparent hover:border-muted-foreground'
                    )}
                  >✕</button>
                  {CUSTOM_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.label}
                      onClick={() => patchDevice({ custom_color: c.id })}
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition-all',
                        c.swatch,
                        deviceDialog.form.custom_color === c.id
                          ? 'border-primary ring-1 ring-primary scale-110'
                          : 'border-transparent hover:scale-105'
                      )}
                    />
                  ))}
                </div>
              </div>
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
