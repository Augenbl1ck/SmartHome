import { LucideIcon, Lightbulb, Plug, Thermometer, Droplets, Activity, DoorOpen, Lamp, Wind, Cpu } from 'lucide-react';
import { DeviceType } from '@/lib/api';

export const deviceIcons: Record<DeviceType, LucideIcon> = {
  light: Lightbulb,
  plug: Plug,
  sensor_temperature: Thermometer,
  sensor_humidity: Droplets,
  sensor_motion: Activity,
  sensor_door: DoorOpen,
  led: Lamp,
  fan: Wind,
  other: Cpu,
};

export const deviceLabels: Record<DeviceType, string> = {
  light: 'Licht',
  plug: 'Steckdose',
  sensor_temperature: 'Temperatur',
  sensor_humidity: 'Luftfeuchtigkeit',
  sensor_motion: 'Bewegungsmelder',
  sensor_door: 'Tür/Fenster',
  led: 'LED',
  fan: 'Lüfter',
  other: 'Gerät',
};

export function getStatusColor(status: string): string {
  switch (status) {
    case 'on': return 'text-yellow-400';
    case 'off': return 'text-slate-400';
    default: return 'text-slate-500';
  }
}

export function isToggleable(type: DeviceType): boolean {
  return ['light', 'plug', 'led', 'fan'].includes(type);
}

export function isSensor(type: DeviceType): boolean {
  return type.startsWith('sensor_');
}
