const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  status: number;
  blocked: boolean;

  constructor(message: string, status: number, blocked = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.blocked = blocked;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `API error ${res.status}: ${text}`;
    let blocked = false;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string; blocked?: boolean };
      if (typeof j.error === 'string' && j.error) message = j.error;
      else if (typeof j.message === 'string' && j.message) message = j.message;
      if (j.blocked === true) blocked = true;
    } catch { /* not JSON */ }
    throw new ApiError(message, res.status, blocked);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getBootstrap: () => request<BootstrapPayload>('/bootstrap'),

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
  zigbeeInterview: (ieee: string) =>
    request<{ ok: boolean }>(`/zigbee/devices/${encodeURIComponent(ieee)}/interview`, { method: 'POST' }),
  zigbeeRemove: (ieee: string, opts?: { force?: boolean; block?: boolean; clear_cache?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.force) q.set('force', '1');
    if (opts?.block) q.set('block', '1');
    if (opts?.clear_cache) q.set('clear_cache', '1');
    const qs = q.toString();
    return request<{ ok: boolean }>(
      `/zigbee/devices/${encodeURIComponent(ieee)}${qs ? `?${qs}` : ''}`,
      { method: 'DELETE' },
    );
  },
  zigbeeImport: (ieee: string, friendly_name: string, data: { name: string; type: string; room_id: number; vendor?: string; model?: string }) =>
    request<Device>(`/zigbee/devices/${encodeURIComponent(ieee)}/import`, { method: 'POST', body: JSON.stringify({ ...data, friendly_name }) }),
  zigbeeSet: (id: number, payload: Record<string, unknown>, opts?: { get?: boolean }) =>
    request<Device>(`/devices/${id}/zigbee-set`, {
      method: 'POST',
      body: JSON.stringify(opts?.get ? { ...payload, _get: true } : payload),
    }),

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

  // Wetter (Laravel / Open-Meteo)
  getWeather: () => request<WeatherResponse>('/weather'),

  // Bahn / ÖPNV
  getTransitStops: (q: string) =>
    request<{ stops: TransitStop[]; error?: string }>(`/transit/stops?q=${encodeURIComponent(q)}`),
  getTransitBoard: () =>
    request<TransitBoardResponse>('/transit/board'),

  // Energie
  getEnergy: () => request<EnergyOverview>('/energy'),
  getEnergyHistory: (range: EnergyPeriod = 'day') =>
    request<EnergyHistoryResponse>(`/energy/history?range=${range}`),

  // Spotify
  getSpotifyAuthUrl: () => request<{ url: string; error?: string }>('/spotify/auth-url'),
  disconnectSpotify: () =>
    request<{ connected: boolean; display_name: string | null }>('/spotify/disconnect', { method: 'DELETE' }),
  getSpotifyStatus: () =>
    request<{ connected: boolean; display_name: string | null; has_streaming?: boolean }>('/spotify/status'),
  getSpotifyToken: () =>
    request<{ access_token: string; expires_in: number }>('/spotify/token'),
  getSpotifyPlayer: () => request<SpotifyPlayerState>('/spotify/player'),
  spotifyPlay: (body?: { uri?: string; device_id?: string }) =>
    request<{ ok?: boolean; error?: string }>('/spotify/player/play', {
      method: 'PUT',
      body: JSON.stringify(body ?? {}),
    }),
  spotifyPause: () =>
    request<{ ok?: boolean; error?: string }>('/spotify/player/pause', { method: 'PUT' }),
  spotifyNext: () =>
    request<{ ok?: boolean; error?: string }>('/spotify/player/next', { method: 'POST' }),
  spotifyPrevious: () =>
    request<{ ok?: boolean; error?: string }>('/spotify/player/previous', { method: 'POST' }),
  spotifyVolume: (volume: number) =>
    request<{ ok?: boolean; error?: string }>(`/spotify/player/volume?volume=${volume}`, { method: 'PUT' }),
  getSpotifyDevices: () =>
    request<{ devices: SpotifyDevice[]; error?: string }>('/spotify/devices'),
  spotifyTransfer: (device_id: string, play = false) =>
    request<{ ok?: boolean; error?: string }>('/spotify/devices/transfer', {
      method: 'PUT',
      body: JSON.stringify({ device_id, play }),
    }),
  spotifySearch: (q: string) =>
    request<SpotifySearchResult>(`/spotify/search?q=${encodeURIComponent(q)}`),
  discoverLan: () => request<LanHost[]>('/discover/lan'),
  getSpotifyQueue: () => request<SpotifyQueueResponse>('/spotify/queue'),
  spotifyAddToQueue: (uri: string) =>
    request<{ ok?: boolean; error?: string }>('/spotify/queue', {
      method: 'POST',
      body: JSON.stringify({ uri }),
    }),
};

export interface PanelSettings {
  pin_hash: string | null;
  pin_enabled: boolean;
  lock_timeout: number;
  screen_timeout: number;
  kiosk_mode: boolean;
  calendar_ical_url?: string | null;
  dashboard_layout?: {
    roomOrder?: number[];
    sectionOrder?: string[];
    hiddenSections?: string[];
    fields?: { id: string; name: string; deviceIds: number[] }[];
  } | null;
  weather?: { city?: string; unit?: 'metric' | 'imperial' } | null;
  transit?: TransitConfig | null;
  energy?: { price_per_kwh?: number } | null;
  spotify?: { connected?: boolean; display_name?: string | null; has_streaming?: boolean } | null;
  theme?: 'light' | 'dark' | 'system';
  favorites?: number[];
  scene_snapshots?: Record<string, unknown> | null;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
  supports_volume?: boolean;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  duration_ms: number;
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  owner: string;
  image: string | null;
  tracks_total: number;
}

export interface SpotifyPlayerState {
  configured: boolean;
  connected: boolean;
  active: boolean;
  is_playing?: boolean;
  progress_ms?: number;
  volume_percent?: number | null;
  device?: SpotifyDevice | null;
  item?: SpotifyTrack | null;
  error?: string | null;
}

export interface SpotifySearchResult {
  tracks: SpotifyTrack[];
  playlists: SpotifyPlaylist[];
  error?: string;
}

export interface SpotifyQueueResponse {
  currently_playing: SpotifyTrack | null;
  queue: SpotifyTrack[];
  error?: string;
}

export interface EnergyDeviceRow {
  id: number;
  name: string;
  type: string;
  power_w: number;
  energy_wh: number | null;
}

export interface EnergyDeviceShare {
  id: number;
  name: string;
  kwh: number;
  cost: number;
  share: number;
}

export type EnergyPeriod = 'day' | 'week' | 'month' | 'year';

export interface EnergyByDevice {
  day: EnergyDeviceShare[];
  week: EnergyDeviceShare[];
  month: EnergyDeviceShare[];
  year: EnergyDeviceShare[];
}

export interface EnergyOverview {
  configured: boolean;
  price_per_kwh: number;
  live_power_w: number;
  today_kwh: number;
  week_kwh: number;
  month_kwh: number;
  year_kwh: number;
  today_cost: number;
  week_cost: number;
  month_cost: number;
  year_cost: number;
  prev_today_kwh?: number;
  prev_week_kwh?: number;
  prev_month_kwh?: number;
  prev_year_kwh?: number;
  prev_today_cost?: number;
  prev_week_cost?: number;
  prev_month_cost?: number;
  prev_year_cost?: number;
  devices: EnergyDeviceRow[];
  by_device?: EnergyByDevice;
  by_device_today: EnergyDeviceShare[];
  sampled_at?: string | null;
  data_since?: string | null;
  error?: string;
}

export function emptyEnergyOverview(error?: string): EnergyOverview {
  return {
    configured: false,
    price_per_kwh: 0.3,
    live_power_w: 0,
    today_kwh: 0,
    week_kwh: 0,
    month_kwh: 0,
    year_kwh: 0,
    today_cost: 0,
    week_cost: 0,
    month_cost: 0,
    year_cost: 0,
    prev_today_kwh: 0,
    prev_week_kwh: 0,
    prev_month_kwh: 0,
    prev_year_kwh: 0,
    prev_today_cost: 0,
    prev_week_cost: 0,
    prev_month_cost: 0,
    prev_year_cost: 0,
    devices: [],
    by_device: { day: [], week: [], month: [], year: [] },
    by_device_today: [],
    data_since: null,
    error,
  };
}

export interface EnergyHistoryBucket {
  label: string;
  start: string;
  kwh: number;
  avg_w: number;
  cost: number;
}

export interface EnergyHistoryResponse {
  range: EnergyPeriod;
  buckets: EnergyHistoryBucket[];
  price_per_kwh: number;
  data_since?: string | null;
}

export interface TransitStopRef {
  id: string;
  name: string;
}

export interface TransitStop extends TransitStopRef {
  type?: string;
}

export interface TransitConnection {
  id: string;
  label: string;
  from: TransitStopRef;
  to: TransitStopRef;
}

export interface TransitConfig {
  stations: TransitStopRef[];
  connections: TransitConnection[];
}

export interface TransitDeparture {
  line: string;
  product: string;
  direction: string;
  when: string;
  plannedWhen: string;
  delay: number | null;
  cancelled: boolean;
  platform: string | null;
}

export interface TransitJourneyLeg {
  line: string;
  direction: string;
  product: string;
}

export interface TransitJourney {
  departure: string;
  arrival: string;
  durationMin: number | null;
  changes: number;
  legs: TransitJourneyLeg[];
  delay: number | null;
  cancelled: boolean;
}

export interface TransitBoardStation {
  stop: TransitStopRef;
  departures: TransitDeparture[];
  error?: string;
}

export interface TransitBoardConnection {
  id: string;
  label: string;
  from: TransitStopRef;
  to: TransitStopRef;
  journeys: TransitJourney[];
  error?: string;
}

export interface TransitBoardResponse {
  configured: boolean;
  stations: TransitBoardStation[];
  connections: TransitBoardConnection[];
  error?: string | null;
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

export interface WeatherCurrent {
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDeg: number | null;
  clouds: number;
  visibility: number | null;
  description: string;
  icon: string;
  city: string;
  sunrise: string | null;
  sunset: string | null;
  uvIndex?: number | null;
  precipitation?: number | null;
  windGusts?: number | null;
}

export interface WeatherHourly {
  time: string;
  temp: number;
  icon: string;
  description: string;
  pop: number;
  humidity: number;
  windSpeed: number;
}

export interface WeatherDaily {
  date: string;
  tempMin: number;
  tempMax: number;
  icon: string;
  description: string;
  pop: number;
  humidity: number;
  windSpeed: number;
  precipitationSum?: number | null;
  uvIndex?: number | null;
}

export interface WeatherResponse {
  configured: boolean;
  unit: 'metric' | 'imperial' | string;
  current?: WeatherCurrent;
  hourly?: WeatherHourly[];
  daily?: WeatherDaily[];
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
  /** Aktive Sperren: Befehl → Automationsname */
  blocked_commands?: Record<string, string>;
}

export type DeviceType =
  | 'light' | 'plug' | 'switch' | 'dimmer' | 'rgb' | 'led'
  | 'fan' | 'cover' | 'thermostat' | 'valve' | 'button'
  | 'computer'
  | 'energy_meter'
  | 'sensor_temperature' | 'sensor_humidity' | 'sensor_motion'
  | 'sensor_door' | 'sensor_flood' | 'sensor_smoke' | 'sensor_lux' | 'sensor_vibration'
  | 'other';

export interface LanHost {
  hostname: string | null;
  ip: string;
  mac: string;
}

export interface Scene {
  id: number;
  name: string;
  icon: string;
  /** Typed actions or legacy { device_id, status } */
  actions: Record<string, unknown>[];
  active: boolean;
}

export interface BootstrapPayload {
  rooms: Room[];
  devices: Device[];
  scenes: Scene[];
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
  model_id?: string;
  manufacturer?: string;
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
