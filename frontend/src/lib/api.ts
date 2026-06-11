const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
  setDeviceStatus: (id: number, status: 'on' | 'off') =>
    request<Device>(`/devices/${id}/set-status`, { method: 'POST', body: JSON.stringify({ status }) }),
  getDeviceLogs: (id: number) => request<DeviceLog[]>(`/devices/${id}/logs`),
  getSensorHistory: (id: number, hours = 24) =>
    request<SensorHistory>(`/devices/${id}/sensor-history?hours=${hours}`),
  saveBleMac: (id: number, ble_address: string) =>
    request<Device>(`/devices/${id}/ble-mac`, { method: 'POST', body: JSON.stringify({ ble_address }) }),

  // BLE Scan
  bleScan: (timeoutMs = 8000) =>
    request<{ devices: { address: string; name: string | null; rssi: number }[] }>(
      `/ble/scan?timeout=${timeoutMs}&prefix=Shelly`
    ),

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
};

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
  | 'light' | 'plug' | 'sensor_temperature' | 'sensor_humidity'
  | 'sensor_motion' | 'sensor_door' | 'led' | 'fan' | 'other';

export interface Scene {
  id: number;
  name: string;
  icon: string;
  actions: { device_id: number; status: 'on' | 'off' | 'toggle' }[];
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
  enabled: boolean;
}
