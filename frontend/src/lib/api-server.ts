import { Automation, Device, Room, Scene } from './api';

const API_BASE = process.env.API_URL ?? 'http://localhost:8000/api/v1';

async function serverFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const serverApi = {
  getRooms: () => serverFetch<Room[]>('/rooms'),
  getDevices: (roomId?: number) =>
    serverFetch<Device[]>(`/devices${roomId ? `?room_id=${roomId}` : ''}`),
  getRoom: (id: number) => serverFetch<Room>(`/rooms/${id}`),
  getAutomations: () => serverFetch<Automation[]>('/automations'),
  getScenes: () => serverFetch<Scene[]>('/scenes'),
};
