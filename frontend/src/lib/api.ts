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

export interface Automation {
  id: number;
  name: string;
  trigger: Record<string, unknown>;
  action: Record<string, unknown>;
  enabled: boolean;
}
