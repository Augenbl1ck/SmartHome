'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Activity, Bell, Clock, DoorOpen, Droplets, Gauge, Home, Power,
  Shield, Sun, Thermometer, Timer, Clapperboard, ToggleLeft,
} from 'lucide-react';
import { ActionType, ConditionType, SCENE_ACTION_TYPES } from '@/lib/automation-form';

export interface BlockChoice<T extends string> {
  type: T;
  label: string;
  hint: string;
  icon: LucideIcon;
  group: string;
}

export const CONDITION_CHOICES: BlockChoice<ConditionType>[] = [
  { type: 'device_status', label: 'Gerät', hint: 'ist an oder aus', icon: Power, group: 'Gerät' },
  { type: 'motion', label: 'Bewegung', hint: 'Sensor erkennt Bewegung', icon: Activity, group: 'Sensor' },
  { type: 'door_open', label: 'Offen', hint: 'Tür oder Fenster ist offen', icon: DoorOpen, group: 'Sensor' },
  { type: 'door_closed', label: 'Geschlossen', hint: 'Tür oder Fenster ist zu', icon: DoorOpen, group: 'Sensor' },
  { type: 'temperature_above', label: 'Temperatur über', hint: 'Schwellwert in °C', icon: Thermometer, group: 'Sensor' },
  { type: 'temperature_below', label: 'Temperatur unter', hint: 'Schwellwert in °C', icon: Thermometer, group: 'Sensor' },
  { type: 'humidity_above', label: 'Feuchte über', hint: 'Schwellwert in %', icon: Droplets, group: 'Sensor' },
  { type: 'humidity_below', label: 'Feuchte unter', hint: 'Schwellwert in %', icon: Droplets, group: 'Sensor' },
  { type: 'power_above', label: 'Leistung über', hint: 'Watt, z.B. Waschmaschine', icon: Gauge, group: 'Sensor' },
  { type: 'power_below', label: 'Leistung unter', hint: 'Watt, Gerät ist fertig', icon: Gauge, group: 'Sensor' },
  { type: 'time_at', label: 'Uhrzeit', hint: 'einmal am Tag', icon: Clock, group: 'Zeit' },
  { type: 'time_between', label: 'Zeitfenster', hint: 'von bis, optional mit Datum', icon: Clock, group: 'Zeit' },
  { type: 'weekday', label: 'Wochentag', hint: 'Mo–So auswählen', icon: Clock, group: 'Zeit' },
  { type: 'sunrise', label: 'Sonnenaufgang', hint: 'mit Offset in Minuten', icon: Sun, group: 'Zeit' },
  { type: 'sunset', label: 'Sonnenuntergang', hint: 'mit Offset in Minuten', icon: Sun, group: 'Zeit' },
  { type: 'child_lock', label: 'Kindersicherung', hint: 'Thermostat verriegelt', icon: Shield, group: 'Thermostat' },
  { type: 'open_window', label: 'Offenes Fenster', hint: 'Thermostat-Erkennung', icon: Thermometer, group: 'Thermostat' },
];

export const ACTION_CHOICES: BlockChoice<ActionType>[] = [
  { type: 'set_device_status', label: 'Schalten', hint: 'ein, aus, öffnen, schließen', icon: Power, group: 'Gerät' },
  { type: 'toggle_device', label: 'Umschalten', hint: 'aktuellen Zustand tauschen', icon: ToggleLeft, group: 'Gerät' },
  { type: 'delayed_off', label: 'Später aus', hint: 'nach X Minuten ausschalten', icon: Timer, group: 'Gerät' },
  { type: 'delayed_on', label: 'Später an', hint: 'nach X Minuten einschalten', icon: Timer, group: 'Gerät' },
  { type: 'set_room_devices', label: 'Ganzer Raum', hint: 'alle Geräte ein oder aus', icon: Home, group: 'Raum' },
  { type: 'activate_scene', label: 'Szene', hint: 'Szene aktivieren', icon: Clapperboard, group: 'Raum' },
  { type: 'notify', label: 'Hinweis', hint: 'Meldung im Dashboard', icon: Bell, group: 'Sonstiges' },
  { type: 'set_thermostat_setpoint', label: 'Sollwert', hint: 'Temperatur am Thermostat', icon: Thermometer, group: 'Klima' },
  { type: 'set_thermostat_mode', label: 'Modus', hint: 'Heizen an oder aus', icon: Thermometer, group: 'Klima' },
  { type: 'set_thermostat_child_lock', label: 'Kindersicherung', hint: 'sperren oder freigeben', icon: Shield, group: 'Klima' },
  { type: 'set_thermostat_open_window', label: 'Fenster-Erkennung', hint: 'an oder aus', icon: Thermometer, group: 'Klima' },
  { type: 'set_thermostat_calibration', label: 'Kalibrierung', hint: 'Offset am Thermostat', icon: Thermometer, group: 'Klima' },
  { type: 'set_thermostat_frost_protection', label: 'Frostschutz', hint: 'untere Temperatur', icon: Thermometer, group: 'Klima' },
  { type: 'thermostat_boost', label: 'Boost', hint: 'kurz stark heizen', icon: Thermometer, group: 'Klima' },
  { type: 'thermostat_timer', label: 'Timer', hint: 'Zieltemperatur für eine Dauer', icon: Timer, group: 'Klima' },
  { type: 'thermostat_clear_boost', label: 'Boost beenden', hint: 'Boost oder Timer stoppen', icon: Timer, group: 'Klima' },
];

export function choicesFor(kind: 'condition' | 'action', scene?: boolean) {
  if (kind === 'condition') return CONDITION_CHOICES;
  return scene ? ACTION_CHOICES.filter((c) => SCENE_ACTION_TYPES.includes(c.type)) : ACTION_CHOICES;
}

export function labelFor(kind: 'condition' | 'action', type: string) {
  const list = kind === 'condition' ? CONDITION_CHOICES : ACTION_CHOICES;
  return list.find((c) => c.type === type)?.label ?? type;
}

export function iconFor(kind: 'condition' | 'action', type: string): LucideIcon {
  const list = kind === 'condition' ? CONDITION_CHOICES : ACTION_CHOICES;
  return list.find((c) => c.type === type)?.icon ?? Power;
}

export default function BlockPicker<T extends string>({
  title,
  choices,
  onPick,
  onClose,
}: {
  title: string;
  choices: BlockChoice<T>[];
  onPick: (type: T) => void;
  onClose: () => void;
}) {
  const groups: string[] = [];
  for (const choice of choices) {
    if (!groups.includes(choice.group)) groups.push(choice.group);
  }
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{title}</p>
        <button type="button" className="text-sm text-muted-foreground underline underline-offset-2" onClick={onClose}>
          Schließen
        </button>
      </div>
      {groups.map((group) => (
        <div key={group} className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{group}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {choices.filter((c) => c.group === group).map((choice) => {
              const Icon = choice.icon;
              return (
                <button
                  key={choice.type}
                  type="button"
                  onClick={() => onPick(choice.type)}
                  className="cursor-pointer flex items-center gap-3 rounded-xl border bg-background px-3 py-3 text-left min-h-14 hover:bg-accent active:scale-[0.99]"
                >
                  <span className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{choice.label}</span>
                    <span className="block text-xs text-muted-foreground truncate">{choice.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
