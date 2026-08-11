/**
 * Thermostat-Capabilities (Spiegel zum Backend ThermostatCapabilities).
 * Status-Schema für setDeviceStatus: cap:<name>:<value>
 * Boost: api.setThermostatCommand
 */

export type ThermostatCapName =
  | 'child_lock'
  | 'open_window'
  | 'local_temperature_calibration'
  | 'frost_protection_temperature';

export function encodeCapStatus(name: ThermostatCapName, value: string): string {
  return `cap:${name}:${value}`;
}

export function isChildLockOn(attrs?: Record<string, unknown> | null): boolean {
  return String(attrs?.child_lock ?? '').toUpperCase() === 'LOCK';
}

export function isOpenWindowOn(attrs?: Record<string, unknown> | null): boolean {
  const v = attrs?.open_window;
  if (typeof v === 'boolean') return v;
  return String(v ?? '').toUpperCase() === 'ON';
}

export function getCalibration(attrs?: Record<string, unknown> | null): number {
  const n = Number(attrs?.local_temperature_calibration);
  return Number.isFinite(n) ? n : 0;
}

export function getFrostProtection(attrs?: Record<string, unknown> | null): number {
  const n = Number(attrs?.frost_protection_temperature);
  return Number.isFinite(n) ? n : 5;
}

export function getRunningStateLabel(attrs?: Record<string, unknown> | null): string | null {
  const s = String(attrs?.running_state ?? '').toLowerCase();
  if (s === 'heat') return 'Heizt';
  if (s === 'idle') return 'Bereit';
  return s || null;
}

export function getBoostRemainingMinutes(attrs?: Record<string, unknown> | null): number {
  const n = Number(attrs?.temporary_mode_duration);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
