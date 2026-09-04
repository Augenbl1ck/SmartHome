import { Automation, AutomationLog, BootstrapPayload, CalendarEventsResponse, Device, EnergyHistoryResponse, EnergyOverview, EnergyPeriod, PanelSettings, Room, Scene, TransitBoardResponse, WeatherResponse } from './api';
import { EMPTY_BOOTSTRAP } from './bootstrap-snapshot';

const API_BASE = process.env.API_URL ?? 'http://localhost:8000/api/v1';

/** Kurz halten: wenn Laravel hängt, Client + localStorage übernehmen. */
const FETCH_MS = 1_500;

async function serverFetch<T>(path: string, revalidate?: number): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_MS),
    ...(revalidate != null
      ? { next: { revalidate } }
      : { cache: 'no-store' }),
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
  getBootstrap: () => serverFetch<BootstrapPayload>('/bootstrap').catch(() => EMPTY_BOOTSTRAP),
  getRooms: () => serverFetch<Room[]>('/rooms'),
  getDevices: (roomId?: number) =>
    serverFetch<Device[]>(`/devices${roomId ? `?room_id=${roomId}` : ''}`),
  getRoom: (id: number) => serverFetch<Room>(`/rooms/${id}`),
  getAutomations: () => serverFetch<Automation[]>('/automations', 10),
  getAutomationLogs: () => serverFetch<AutomationLog[]>('/automation-logs', 15),
  getScenes: () => serverFetch<Scene[]>('/scenes'),
  getPanelSettings: () => serverFetch<PanelSettings>('/panel-settings'),
  getCalendarEvents: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return serverFetch<CalendarEventsResponse>(`/calendar/events${qs ? `?${qs}` : ''}`, 60);
  },
  getDashboardCalendar: () => {
    const now = new Date();
    return serverApi.getMonthCalendar(now.getFullYear(), now.getMonth());
  },
  getMonthCalendar: (year: number, month: number) => {
    const from = new Date(year, month, 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(year, month + 1, 0);
    to.setDate(to.getDate() + 7);
    return serverApi.getCalendarEvents({ from: isoDate(from), to: isoDate(to) });
  },
  getWeather: () => serverFetch<WeatherResponse>('/weather'),
  getTransitBoard: () => serverFetch<TransitBoardResponse>('/transit/board', 30),
  getEnergy: () => serverFetch<EnergyOverview>('/energy', 20),
  getEnergyHistory: (range: EnergyPeriod = 'day') =>
    serverFetch<EnergyHistoryResponse>(`/energy/history?range=${range}`, 20),
};
