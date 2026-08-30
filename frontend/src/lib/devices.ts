import {
  LucideIcon,
  Lightbulb, Plug, Thermometer, Droplets, Activity, DoorOpen, Lamp, Wind, Cpu,
  ToggleLeft, SunDim, Palette, ArrowUpDown, Gauge, Droplet, Radio,
  Zap, Waves, CloudFog, Sun, Vibrate, Monitor,
} from 'lucide-react';
import { Device, DeviceType } from '@/lib/api';

export const deviceIcons: Record<DeviceType, LucideIcon> = {
  light:              Lightbulb,
  plug:               Plug,
  switch:             ToggleLeft,
  dimmer:             SunDim,
  rgb:                Palette,
  led:                Lamp,
  fan:                Wind,
  cover:              ArrowUpDown,
  thermostat:         Gauge,
  valve:              Droplet,
  button:             Radio,
  computer:           Monitor,
  energy_meter:       Zap,
  sensor_temperature: Thermometer,
  sensor_humidity:    Droplets,
  sensor_motion:      Activity,
  sensor_door:        DoorOpen,
  sensor_flood:       Waves,
  sensor_smoke:       CloudFog,
  sensor_lux:         Sun,
  sensor_vibration:   Vibrate,
  other:              Cpu,
};

export const deviceLabels: Record<DeviceType, string> = {
  light:              'Licht',
  plug:               'Steckdose',
  switch:             'Schalter',
  dimmer:             'Dimmer',
  rgb:                'RGB-Licht',
  led:                'LED-Streifen',
  fan:                'Lüfter',
  cover:              'Rollladen',
  thermostat:         'Thermostat',
  valve:              'Ventil',
  button:             'Szenen-Taster',
  computer:           'Computer',
  energy_meter:       'Energiemessung',
  sensor_temperature: 'Temperatur',
  sensor_humidity:    'Luftfeuchtigkeit',
  sensor_motion:      'Bewegungsmelder',
  sensor_door:        'Tür/Fenster',
  sensor_flood:       'Wassersensor',
  sensor_smoke:       'Rauchmelder',
  sensor_lux:         'Helligkeitssensor',
  sensor_vibration:   'Erschütterungssensor',
  other:              'Gerät',
};

export interface DeviceColorSet { text: string; bg: string }

export const deviceColors: Record<DeviceType, DeviceColorSet> = {
  light:              { text: 'text-amber-500',        bg: 'bg-amber-500/10' },
  plug:               { text: 'text-blue-500',         bg: 'bg-blue-500/10' },
  switch:             { text: 'text-slate-400',        bg: 'bg-slate-500/10' },
  dimmer:             { text: 'text-yellow-400',       bg: 'bg-yellow-500/10' },
  rgb:                { text: 'text-pink-500',         bg: 'bg-pink-500/10' },
  led:                { text: 'text-violet-400',       bg: 'bg-violet-500/10' },
  fan:                { text: 'text-cyan-400',         bg: 'bg-cyan-500/10' },
  cover:              { text: 'text-stone-400',        bg: 'bg-stone-500/10' },
  thermostat:         { text: 'text-orange-400',       bg: 'bg-orange-500/10' },
  valve:              { text: 'text-teal-400',         bg: 'bg-teal-500/10' },
  button:             { text: 'text-indigo-400',       bg: 'bg-indigo-500/10' },
  computer:           { text: 'text-sky-400',         bg: 'bg-sky-500/10' },
  energy_meter:       { text: 'text-yellow-500',       bg: 'bg-yellow-500/10' },
  sensor_temperature: { text: 'text-orange-400',       bg: 'bg-orange-500/10' },
  sensor_humidity:    { text: 'text-sky-400',          bg: 'bg-sky-500/10' },
  sensor_motion:      { text: 'text-emerald-400',      bg: 'bg-emerald-500/10' },
  sensor_door:        { text: 'text-zinc-400',         bg: 'bg-zinc-500/10' },
  sensor_flood:       { text: 'text-blue-400',         bg: 'bg-blue-500/10' },
  sensor_smoke:       { text: 'text-red-400',          bg: 'bg-red-500/10' },
  sensor_lux:         { text: 'text-yellow-300',       bg: 'bg-yellow-400/10' },
  sensor_vibration:   { text: 'text-purple-400',       bg: 'bg-purple-500/10' },
  other:              { text: 'text-muted-foreground', bg: 'bg-muted' },
};

export function getStatusColor(status: string): string {
  switch (status) {
    case 'on':  return 'text-yellow-400';
    case 'off': return 'text-slate-400';
    default:    return 'text-slate-500';
  }
}

// ── Custom Icon / Color ───────────────────────────────────────────────────────

/** Vordefinierte Farb-Palette für benutzerdefinierte Geräte-Farben. */
export const CUSTOM_COLORS: Array<{ id: string; label: string; swatch: string } & DeviceColorSet> = [
  { id: 'amber',   label: 'Amber',   swatch: 'bg-amber-500',   text: 'text-amber-500',   bg: 'bg-amber-500/10' },
  { id: 'blue',    label: 'Blau',    swatch: 'bg-blue-500',    text: 'text-blue-500',    bg: 'bg-blue-500/10' },
  { id: 'green',   label: 'Grün',    swatch: 'bg-green-500',   text: 'text-green-500',   bg: 'bg-green-500/10' },
  { id: 'red',     label: 'Rot',     swatch: 'bg-red-500',     text: 'text-red-500',     bg: 'bg-red-500/10' },
  { id: 'violet',  label: 'Violett', swatch: 'bg-violet-500',  text: 'text-violet-400',  bg: 'bg-violet-500/10' },
  { id: 'pink',    label: 'Pink',    swatch: 'bg-pink-500',    text: 'text-pink-500',    bg: 'bg-pink-500/10' },
  { id: 'cyan',    label: 'Cyan',    swatch: 'bg-cyan-400',    text: 'text-cyan-400',    bg: 'bg-cyan-500/10' },
  { id: 'orange',  label: 'Orange',  swatch: 'bg-orange-500',  text: 'text-orange-400',  bg: 'bg-orange-500/10' },
  { id: 'teal',    label: 'Teal',    swatch: 'bg-teal-400',    text: 'text-teal-400',    bg: 'bg-teal-500/10' },
  { id: 'sky',     label: 'Sky',     swatch: 'bg-sky-400',     text: 'text-sky-400',     bg: 'bg-sky-500/10' },
  { id: 'emerald', label: 'Smaragd', swatch: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { id: 'rose',    label: 'Rose',    swatch: 'bg-rose-400',    text: 'text-rose-400',    bg: 'bg-rose-500/10' },
];

/** Gibt die Farbe für ein Gerät zurück — respektiert `attributes.custom_color`. */
export function getDeviceColors(device: Device): DeviceColorSet {
  const customColor = device.attributes?.custom_color as string | undefined;
  if (customColor) {
    const match = CUSTOM_COLORS.find(c => c.id === customColor);
    if (match) return { text: match.text, bg: match.bg };
  }
  return deviceColors[device.type as DeviceType] ?? deviceColors.other;
}

/** Gibt das Custom-Emoji zurück (oder null wenn keins gesetzt). */
export function getDeviceEmoji(device: Device): string | null {
  const emoji = device.attributes?.custom_emoji as string | undefined;
  return emoji?.trim() || null;
}

export function isToggleable(type: DeviceType): boolean {
  return ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan', 'cover', 'valve'].includes(type);
}

export function isComputer(type: DeviceType): boolean {
  return type === 'computer';
}

/** Geräte die in der „X aktiv“-Anzeige mitzählen (Computer ohne Ausschalten). */
export function countsAsActive(type: DeviceType): boolean {
  return isToggleable(type) || isComputer(type);
}

/** MAC als AA:BB:CC:DD:EE:FF formatieren (Eingabe darf Bindestriche/Leerzeichen enthalten). */
export function formatMacAddress(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 12).toUpperCase();
  return (hex.match(/.{1,2}/g) ?? []).join(':');
}

export function isSensor(type: DeviceType): boolean {
  return type.startsWith('sensor_') || type === 'energy_meter';
}

/** Grund falls dieser Befehl gerade durch eine Sperre verboten ist. */
export function commandBlocked(device: Device, command: string): string | undefined {
  const map = device.blocked_commands;
  if (!map) return undefined;
  const key = command.toLowerCase();
  if (map[key]) return map[key];
  if (device.type === 'thermostat' && (key === 'on' || key === 'heat' || key === 'auto')) {
    return map.heat ?? map.on;
  }
  return undefined;
}

/** Nächster Toggle-Befehl (an/aus bzw. heat/off, open/close) und ob der blockiert ist. */
export function nextToggleCommand(device: Device): string {
  const type = device.type as DeviceType;
  if (type === 'thermostat') {
    const active = ['auto', 'heat', 'on'].includes(device.status);
    return active ? 'off' : 'heat';
  }
  if (type === 'cover' || type === 'valve') {
    return device.status === 'open' ? 'close' : 'open';
  }
  if (isComputer(type)) {
    return 'on';
  }
  return device.status === 'on' ? 'off' : 'on';
}

export function nextCommandBlocked(device: Device): string | undefined {
  return commandBlocked(device, nextToggleCommand(device));
}

export function isInterlockAutomation(a: { trigger?: Record<string, unknown> }): boolean {
  return (a.trigger?.type ?? '') === 'interlock';
}
