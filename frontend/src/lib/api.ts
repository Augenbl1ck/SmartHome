const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    ...options,
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Rooms
  getRooms: () => request<Room[]>('/rooms'),
  getRoom: (id: number) => request<Room>(`/rooms/${id}`),
  createRoom: (data: Partial<Room>) => request<Room>('/rooms', { method: 'POST', body: JSON.stringify(data) }),
  updateRoom: (id: number, data: Partial<Room>) => request<Room>(`/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoom: (id: number) => request<void>(`/rooms/${id}`, { method: 'DELETE' }),

  // Devices
  getDevices: (roomId?: number) => request<Device[]>(`/devices${roomId ? `?room_id=${roomId}` : ''}`),
  getDevice: (id: number) => request<Device>(`/devices/${id}`),
  createDevice: (data: Partial<Device>) => request<Device>('/devices', { method: 'POST', body: JSON.stringify(data) }),
  updateDevice: (id: number, data: Partial<Device>) => request<Device>(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDevice: (id: number) => request<void>(`/devices/${id}`, { method: 'DELETE' }),
  toggleDevice: (id: number) => request<Device>(`/devices/${id}/toggle`, { method: 'POST' }),
  setDeviceStatus: (id: number, status: string) =>
    request<Device>(`/devices/${id}/set-status`, { method: 'POST', body: JSON.stringify({ status }) }),
  setThermostatCommand: (id: number, body: Record<string, unknown>) =>
    request<Device>(`/devices/${id}/thermostat`, { method: 'POST', body: JSON.stringify(body) }),
  getDeviceLogs: (id: number) => request<DeviceLog[]>(`/devices/${id}/logs`),
  getSensorHistory: (id: number, hours = 24) =>
    request<SensorHistory>(`/devices/${id}/sensor-history?hours=${hours}`),
  saveBleMac: (id: number, ble_address: string) =>
    request<Device>(`/devices/${id}/ble-mac`, { method: 'POST', body: JSON.stringify({ ble_address }) }),
  shellyRpc: (id: number, method: string, params: Record<string, unknown> = {}) =>
    request<{ result: unknown }>(`/devices/${id}/shelly-rpc`, { method: 'POST', body: JSON.stringify({ method, params }) }),

  // BLE Scan
  bleScan: (timeoutMs = 8000) =>
    request<{ devices: { address: string; name: string | null; rssi: number }[] }>(
      `/ble/scan?timeout=${timeoutMs}&prefix=Shelly`
    ),

  // BLE RPC — sendet beliebige Shelly-Befehle via BLE Bridge
  bleRpc: (deviceId: number, method: string, params: Record<string, unknown> = {}) =>
    request<{ result: unknown }>(`/devices/${deviceId}/ble-rpc`, {
      method: 'POST',
      body: JSON.stringify({ method, params }),
    }),

  // Scenes
  getScenes: () => request<Scene[]>('/scenes'),
  createScene: (data: Partial<Scene>) => request<Scene>('/scenes', { method: 'POST', body: JSON.stringify(data) }),
  updateScene: (id: number, data: Partial<Scene>) => request<Scene>(`/scenes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteScene: (id: number) => request<void>(`/scenes/${id}`, { method: 'DELETE' }),
  activateScene: (id: number) => request<{ activated: boolean; scene: string }>(`/scenes/${id}/activate`, { method: 'POST' }),

  // Automations
  getAutomations: () => request<Automation[]>('/automations'),
  createAutomation: (data: Partial<Automation>) => request<Automation>('/automations', { method: 'POST', body: JSON.stringify(data) }),
  updateAutomation: (id: number, data: Partial<Automation>) => request<Automation>(`/automations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAutomation: (id: number) => request<void>(`/automations/${id}`, { method: 'DELETE' }),
  getAutomationLogs: () => request<AutomationLog[]>('/automation-logs'),

  // Zigbee Management
  getZigbeeDevices: () => request<ZigbeeDevice[]>('/zigbee/devices'),
  zigbeePermitJoin: (enable: boolean, timeout = 120) =>
    request<{ ok: boolean }>('/zigbee/permit-join', { method: 'POST', body: JSON.stringify({ enable, timeout }) }),
  zigbeeRename: (ieee: string, name: string) =>
    request<{ ok: boolean }>(`/zigbee/devices/${encodeURIComponent(ieee)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  zigbeeRemove: (ieee: string) =>
    request<{ ok: boolean }>(`/zigbee/devices/${encodeURIComponent(ieee)}`, { method: 'DELETE' }),
  zigbeeImport: (ieee: string, friendly_name: string, data: { name: string; type: string; room_id: number }) =>
    request<Device>(`/zigbee/devices/${encodeURIComponent(ieee)}/import`, { method: 'POST', body: JSON.stringify({ ...data, friendly_name }) }),

  // Push Notifications
  pushSubscribe: (sub: { endpoint: string; public_key: string; auth_token: string; device_name?: string }) =>
    request<{ ok: boolean }>('/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  pushTest: () =>
    request<{ ok: boolean }>('/push/test', { method: 'POST' }),

  // System Status
  getSystemStatus: () =>
    request<SystemStatus>('/system/status'),

  // Panel-Einstellungen (PIN / Kiosk) — serverseitig, überlebt Reboot
  getPanelSettings: () =>
    request<PanelSettings>('/panel-settings'),
  updatePanelSettings: (data: Partial<PanelSettings>) =>
    request<PanelSettings>('/panel-settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Kalender (FamilyWall / iCal)
  getCalendarEvents: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return request<CalendarEventsResponse>(`/calendar/events${qs ? `?${qs}` : ''}`);
  },
};

export interface PanelSettings {
  pin_hash: string | null;
  pin_enabled: boolean;
  lock_timeout: number;
  screen_timeout: number;
  kiosk_mode: boolean;
  calendar_ical_url?: string | null;
}

export interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string | null;
  all_day: boolean;
}

export interface CalendarEventsResponse {
  events: CalendarEvent[];
  configured: boolean;
  error?: string;
}

// Types
export interface Room {
  id: number;
  name: string;
  icon: string;
  devices_count?: number;
  devices?: Device[];
}

export interface Device {
  id: number;
  name: string;
  type: DeviceType;
  room_id: number;
  room?: Room;
  mqtt_topic: string;
  status: string;
  attributes?: Record<string, unknown>;
  last_seen?: string;
  active: boolean;
}

export type DeviceType =
  | 'light' | 'plug' | 'switch' | 'dimmer' | 'rgb' | 'led'
  | 'fan' | 'cover' | 'thermostat' | 'valve' | 'button'
  | 'energy_meter'
  | 'sensor_temperature' | 'sensor_humidity' | 'sensor_motion'
  | 'sensor_door' | 'sensor_flood' | 'sensor_smoke' | 'sensor_lux' | 'sensor_vibration'
  | 'other';

export interface Scene {
  id: number;
  name: string;
  icon: string;
  /** Typed actions or legacy { device_id, status } */
  actions: Record<string, unknown>[];
  active: boolean;
}

export interface DeviceLog {
  id: number;
  status: string;
  recorded_at: string;
}

export interface SensorReading {
  time: string;
  value: number;
  min: number;
  max: number;
}

export interface SensorHistory {
  readings: SensorReading[];
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface Automation {
  id: number;
  name: string;
  trigger: Record<string, unknown>;
  action: Record<string, unknown>;
  conditions?: {
    logic: 'and' | 'or';
    items: Record<string, unknown>[];
  } | null;
  enabled: boolean;
}

export interface AutomationLog {
  id: number;
  automation_id: number | null;
  automation_name: string;
  action_summary: string;
  fired_at: string;
}

export interface ZigbeeDevice {
  ieee_address: string;
  friendly_name: string;
  type: string;
  supported: boolean;
  interview_completed: boolean;
  definition?: {
    vendor?: string;
    model?: string;
    description?: string;
  };
  last_seen?: number;
  smarthome_device?: Device | null;
}

export interface SystemStatus {
  cpu_temp: number | null;
  uptime: number | null;
  memory_used: number | null;
  disk_used: number | null;
}
