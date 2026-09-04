import { create } from 'zustand';
import { api, Device, Room, Scene, type BootstrapPayload } from '@/lib/api';
import { saveBootstrapSnapshot } from '@/lib/bootstrap-snapshot';

interface SmartHomeState {
  rooms: Room[];
  devices: Device[];
  scenes: Scene[];
  hydrated: boolean;
  loading: boolean;

  hydrate: (data: Partial<BootstrapPayload>) => void;
  upsertDevice: (device: Device) => void;
  patchDevice: (id: number, patch: Partial<Device>) => void;
  removeDevice: (id: number) => void;
  replaceRoomDevices: (roomId: number, devices: Device[]) => void;
  setRooms: (rooms: Room[]) => void;
  upsertRoom: (room: Room) => void;
  removeRoom: (id: number) => void;
  setScenes: (scenes: Scene[]) => void;
  fetchBootstrap: () => Promise<void>;
  fetchDevices: (roomId?: number) => Promise<void>;
}

export const useSmartHomeStore = create<SmartHomeState>((set, get) => ({
  rooms: [],
  devices: [],
  scenes: [],
  hydrated: false,
  loading: false,

  hydrate: (data) => set((state) => {
    const nextRooms = data.rooms ?? state.rooms;
    const nextDevices = data.devices ?? state.devices;
    const nextScenes = data.scenes ?? state.scenes;
    const incomingEmpty = (data.rooms?.length ?? 0) === 0
      && (data.devices?.length ?? 0) === 0
      && (data.scenes?.length ?? 0) === 0
      && data.rooms !== undefined
      && data.devices !== undefined;
    if (incomingEmpty && (state.rooms.length > 0 || state.devices.length > 0)) {
      return state;
    }
    return {
      rooms: nextRooms,
      devices: nextDevices,
      scenes: nextScenes,
      hydrated: incomingEmpty && !state.hydrated ? false : true,
    };
  }),

  upsertDevice: (device) => set((state) => {
    const idx = state.devices.findIndex((d) => d.id === device.id);
    const devices = idx === -1
      ? [...state.devices, device]
      : state.devices.map((d) => (d.id === device.id ? { ...d, ...device } : d));
    return { devices };
  }),

  patchDevice: (id, patch) => set((state) => ({
    devices: state.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  })),

  removeDevice: (id) => set((state) => ({
    devices: state.devices.filter((d) => d.id !== id),
  })),

  replaceRoomDevices: (roomId, roomDevices) => set((state) => ({
    devices: [
      ...state.devices.filter((d) => d.room_id !== roomId),
      ...roomDevices,
    ],
  })),

  setRooms: (rooms) => set({ rooms }),

  upsertRoom: (room) => set((state) => {
    const idx = state.rooms.findIndex((r) => r.id === room.id);
    const rooms = idx === -1
      ? [...state.rooms, room]
      : state.rooms.map((r) => (r.id === room.id ? { ...r, ...room } : r));
    return { rooms };
  }),

  removeRoom: (id) => set((state) => ({
    rooms: state.rooms.filter((r) => r.id !== id),
    devices: state.devices.filter((d) => d.room_id !== id),
  })),

  setScenes: (scenes) => set({ scenes }),

  fetchBootstrap: async () => {
    set({ loading: true });
    try {
      const data = await api.getBootstrap();
      set({
        rooms: data.rooms,
        devices: data.devices,
        scenes: data.scenes,
        hydrated: true,
        loading: false,
      });
      saveBootstrapSnapshot(data);
    } catch {
      set({ loading: false });
    }
  },

  fetchDevices: async (roomId?: number) => {
    set({ loading: true });
    try {
      const devices = await api.getDevices(roomId);
      if (roomId != null) {
        get().replaceRoomDevices(roomId, devices);
      } else {
        set({ devices });
      }
    } finally {
      set({ loading: false });
    }
  },
}));
