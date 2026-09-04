import type { BootstrapPayload } from './api';

export const BOOTSTRAP_SNAPSHOT_KEY = 'smarthome_bootstrap_snapshot';

export const EMPTY_BOOTSTRAP: BootstrapPayload = {
  rooms: [],
  devices: [],
  scenes: [],
};

export function loadBootstrapSnapshot(): BootstrapPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BOOTSTRAP_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BootstrapPayload>;
    if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.devices)) return null;
    return {
      rooms: parsed.rooms,
      devices: parsed.devices,
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      weather: parsed.weather ?? null,
      transit: parsed.transit ?? null,
      energy: parsed.energy ?? null,
      calendar: parsed.calendar ?? null,
    };
  } catch {
    return null;
  }
}

export function saveBootstrapSnapshot(data: BootstrapPayload): void {
  if (typeof window === 'undefined') return;
  if (data.rooms.length === 0 && data.devices.length === 0) return;
  try {
    localStorage.setItem(BOOTSTRAP_SNAPSHOT_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function mergeBootstrap(
  base: Partial<BootstrapPayload> | null | undefined,
  overlay: Partial<BootstrapPayload> | null | undefined,
): BootstrapPayload {
  return {
    rooms: overlay?.rooms ?? base?.rooms ?? [],
    devices: overlay?.devices ?? base?.devices ?? [],
    scenes: overlay?.scenes ?? base?.scenes ?? [],
    weather: overlay?.weather ?? base?.weather ?? null,
    transit: overlay?.transit ?? base?.transit ?? null,
    energy: overlay?.energy ?? base?.energy ?? null,
    calendar: overlay?.calendar ?? base?.calendar ?? null,
  };
}

export function bootstrapHasContent(data: Partial<BootstrapPayload> | null | undefined): boolean {
  return (data?.rooms?.length ?? 0) > 0 || (data?.devices?.length ?? 0) > 0;
}
