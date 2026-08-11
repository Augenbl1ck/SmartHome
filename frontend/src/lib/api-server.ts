import { Automation, AutomationLog, CalendarEventsResponse, Device, EnergyHistoryResponse, EnergyOverview, PanelSettings, Room, Scene, TransitBoardResponse, WeatherResponse } from './api';
import { fetchWeatherData } from './weather-fetch';

const API_BASE = process.env.API_URL ?? 'http://localhost:8000/api/v1';

async function serverFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

/** Local calendar date YYYY-MM-DD (avoid UTC shift from toISOString). */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const serverApi = {
  getRooms: () => serverFetch<Room[]>('/rooms'),
  getDevices: (roomId?: number) =>
    serverFetch<Device[]>(`/devices${roomId ? `?room_id=${roomId}` : ''}`),
  getRoom: (id: number) => serverFetch<Room>(`/rooms/${id}`),
  getAutomations: () => serverFetch<Automation[]>('/automations'),
  getAutomationLogs: () => serverFetch<AutomationLog[]>('/automation-logs'),
  getScenes: () => serverFetch<Scene[]>('/scenes'),
  getPanelSettings: () => serverFetch<PanelSettings>('/panel-settings'),
  getCalendarEvents: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return serverFetch<CalendarEventsResponse>(`/calendar/events${qs ? `?${qs}` : ''}`);
  },
  getDashboardCalendar: () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 14);
    return serverApi.getCalendarEvents({ from: isoDate(from), to: isoDate(to) });
  },
  getMonthCalendar: (year: number, month: number) => {
    const from = new Date(year, month, 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(year, month + 1, 0);
    to.setDate(to.getDate() + 7);
    return serverApi.getCalendarEvents({ from: isoDate(from), to: isoDate(to) });
  },
  getWeather: async (): Promise<WeatherResponse> => {
    const settings = await serverApi.getPanelSettings();
    return fetchWeatherData(settings);
  },
  getTransitBoard: () => serverFetch<TransitBoardResponse>('/transit/board'),
  getEnergy: () => serverFetch<EnergyOverview>('/energy'),
  getEnergyHistory: (range: 'day' | 'week' = 'day') =>
    serverFetch<EnergyHistoryResponse>(`/energy/history?range=${range}`),
};
