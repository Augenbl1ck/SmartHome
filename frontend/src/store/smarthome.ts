import { create } from 'zustand';
import { api, Device, Room } from '@/lib/api';

interface SmartHomeState {
  rooms: Room[];
  devices: Device[];
  loading: boolean;

  fetchRooms: () => Promise<void>;
  fetchDevices: (roomId?: number) => Promise<void>;
  toggleDevice: (id: number) => Promise<void>;
  setDeviceStatus: (id: number, status: string) => void;
}

export const useSmartHomeStore = create<SmartHomeState>((set, get) => ({
  rooms: [],
  devices: [],
  loading: false,

  fetchRooms: async () => {
    set({ loading: true });
    const rooms = await api.getRooms();
    set({ rooms, loading: false });
  },

  fetchDevices: async (roomId?: number) => {
    set({ loading: true });
    const devices = await api.getDevices(roomId);
    set({ devices, loading: false });
  },

  toggleDevice: async (id: number) => {
    const updated = await api.toggleDevice(id);
    set((state) => ({
      devices: state.devices.map((d) => (d.id === id ? updated : d)),
    }));
  },

  setDeviceStatus: (id: number, status: string) => {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id ? { ...d, status, last_seen: new Date().toISOString() } : d
      ),
    }));
  },
}));
