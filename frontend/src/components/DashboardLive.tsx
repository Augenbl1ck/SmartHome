'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Power, LayoutGrid } from 'lucide-react';
import { api, Device, Room } from '@/lib/api';
import { DeviceType } from '@/lib/api';
import { deviceLabels, deviceIcons, deviceColors, isToggleable } from '@/lib/devices';
import { DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { getEcho, disconnectEcho } from '@/lib/echo';
import { cn } from '@/lib/utils';
import QuickAccess from '@/components/QuickAccess';
import DashboardActions from '@/components/DashboardActions';
import WeatherWidget from '@/components/WeatherWidget';

const WIDGETS_KEY = 'smarthome_dashboard_widgets';

function loadWidgetIds(): number[] {
  try {
    const raw = localStorage.getItem(WIDGETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

interface Props {
  initialDevices: Device[];
  rooms: Room[];
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return 'Gute Nacht';
  if (h < 12) return 'Guten Morgen';
  if (h < 17) return 'Guten Tag';
  if (h < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

function SmallStatusValue({ device }: { device: Device }) {
  const type = device.type as DeviceType;
  const val  = device.status !== 'unknown' ? device.status : '–';

  if (type === 'sensor_temperature') {
    return (
      <p className="text-xl font-bold tabular-nums leading-tight">
        {val}<span className="text-xs font-normal text-muted-foreground ml-0.5">°C</span>
      </p>
    );
  }
  if (type === 'sensor_humidity') {
    return (
      <p className="text-xl font-bold tabular-nums leading-tight">
        {val}<span className="text-xs font-normal text-muted-foreground ml-0.5">%</span>
      </p>
    );
  }
  if (type === 'energy_meter') {
    return (
      <p className="text-xl font-bold tabular-nums leading-tight">
        {val}<span className="text-xs font-normal text-muted-foreground ml-0.5">W</span>
      </p>
    );
  }
  if (type === 'sensor_lux') {
    return (
      <p className="text-xl font-bold tabular-nums leading-tight">
        {val}<span className="text-xs font-normal text-muted-foreground ml-0.5">lx</span>
      </p>
    );
  }
  if (['sensor_motion', 'sensor_door', 'sensor_flood', 'sensor_vibration'].includes(type)) {
    const active = device.status === 'on' || device.status === 'true';
    return (
      <p className={cn('text-base font-bold leading-tight', active ? 'text-amber-500' : 'text-muted-foreground')}>
        {active ? 'Aktiv' : 'Ruhig'}
      </p>
    );
  }
  const isOn = device.status === 'on';
  return (
    <p className={cn('text-base font-bold leading-tight', isOn ? 'text-green-500' : 'text-muted-foreground')}>
      {isOn ? 'An' : 'Aus'}
    </p>
  );
}

export default function DashboardLive({ initialDevices, rooms }: Props) {
  const [devices,   setDevices]   = useState<Device[] | null>(null);
  const [widgetIds, setWidgetIds] = useState<number[]>([]);
  const [mounted,   setMounted]   = useState(false);

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.getDevices();
      setDevices(fresh);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setMounted(true);
    setWidgetIds(loadWidgetIds());
    refresh();

    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);

    // Fallback-Polling alle 5 Minuten (falls WebSocket getrennt)
    const interval = setInterval(refresh, 5 * 60_000);

    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev ? prev.map(d => d.id === id ? { ...d, status } : d) : prev);
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);

    const onStorage = (e: StorageEvent) => {
      if (e.key === WIDGETS_KEY) setWidgetIds(loadWidgetIds());
    };
    window.addEventListener('storage', onStorage);

    // WebSocket: Echtzeit-Updates via Laravel Reverb
    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('devices').listen('.device.updated', (data: {
        id: number; status: string; attributes: Record<string, unknown>; last_seen: string;
      }) => {
        setDevices(prev => prev
          ? prev.map(d => d.id === data.id
              ? { ...d, status: data.status, attributes: data.attributes, last_seen: data.last_seen }
              : d)
          : prev
        );
      });
    } catch (err) {
      console.warn('[WebSocket] Reverb nicht erreichbar, nur Polling aktiv', err);
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
      if (echo) {
        echo.leaveChannel('devices');
        disconnectEcho();
      }
    };
  }, [refresh]);

  const loaded            = devices !== null;
  const list              = devices ?? [];
  const activeDevices     = list.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
  const toggleableDevices = list.filter(d => isToggleable(d.type as DeviceType)).length;

  const widgetDevices = loaded && widgetIds.length > 0
    ? widgetIds.map(id => list.find(d => d.id === id)).filter(Boolean) as Device[]
    : [];

  return (
    <div className="space-y-6">

      {/* ── Begrüßung ────────────────────────────────────────────── */}
      {mounted && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{getGreeting()}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{getFormattedDate()}</p>
        </div>
      )}

      {/* ── Statistiken ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

        {/* Aktiv-Kachel */}
        <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
          <div className="rounded-xl bg-blue-500/10 p-2.5 shrink-0">
            <Power className="h-5 w-5 text-blue-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Aktiv</p>
            {loaded ? (
              <>
                <p className="text-2xl font-bold tabular-nums leading-tight">
                  {activeDevices}
                  <span className="text-sm font-normal text-muted-foreground">/{toggleableDevices}</span>
                </p>
                <p className="text-xs text-muted-foreground">Geräte an</p>
              </>
            ) : (
              <div className="h-8 w-16 bg-muted animate-pulse rounded mt-1" />
            )}
          </div>
        </div>

        {/* Räume-Kachel */}
        <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
          <div className="rounded-xl bg-violet-500/10 p-2.5 shrink-0">
            <LayoutGrid className="h-5 w-5 text-violet-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Räume</p>
            <p className="text-2xl font-bold tabular-nums leading-tight">{rooms.length}</p>
            <p className="text-xs text-muted-foreground">Bereiche</p>
          </div>
        </div>

        {/* Widget-Kacheln (konfigurierbar) */}
        {loaded
          ? widgetDevices.slice(0, 2).map(s => {
              const type   = s.type as DeviceType;
              const Icon   = deviceIcons[type] ?? deviceIcons.other;
              const colors = deviceColors[type] ?? deviceColors.other;
              return (
                <div key={s.id} className="rounded-2xl border bg-card p-4 flex items-center gap-3">
                  <div className={cn('rounded-xl p-2.5 shrink-0', colors.bg)}>
                    <Icon className={cn('h-5 w-5', colors.text)} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                      {s.name}
                    </p>
                    <SmallStatusValue device={s} />
                    <p className="text-xs text-muted-foreground truncate">
                      {rooms.find(r => r.id === s.room_id)?.name ?? deviceLabels[type] ?? ''}
                    </p>
                  </div>
                </div>
              );
            })
          : widgetIds.length > 0
          ? widgetIds.slice(0, 2).map(i => (
              <div key={i} className="rounded-2xl border bg-card p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="h-10 w-10 bg-muted rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-2.5 bg-muted rounded w-20" />
                    <div className="h-6 bg-muted rounded w-14" />
                  </div>
                </div>
              </div>
            ))
          : null
        }
      </div>

      {/* ── Wetter + Alle ausschalten ────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start">
        <div className="flex-1"><WeatherWidget /></div>
        <DashboardActions devices={list} />
      </div>

      {/* ── Schnellzugriff ───────────────────────────────────────── */}
      {mounted && <QuickAccess initialDevices={loaded ? list : initialDevices} />}

      {/* ── Räume ────────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Räume</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.map(room => {
            const roomDevices = list.filter(d => d.room_id === room.id);
            const active      = roomDevices.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
            return (
              <Link key={room.id} href={`/rooms/${room.id}`}>
                <div className={cn(
                  'rounded-2xl border p-4 flex flex-col gap-3 min-h-[130px] cursor-pointer',
                  'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97]',
                  active > 0
                    ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/[0.07] to-card'
                    : 'bg-card hover:bg-accent/40'
                )}>
                  <div className={cn(
                    'w-11 h-11 rounded-xl flex items-center justify-center text-2xl select-none',
                    active > 0 ? 'bg-amber-500/15' : 'bg-muted'
                  )}>
                    {room.icon ?? '🏠'}
                  </div>
                  <div className="mt-auto">
                    <p className="font-semibold text-sm leading-tight">{room.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={cn(
                        'h-1.5 w-1.5 rounded-full transition-colors',
                        active > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30'
                      )} />
                      <p className="text-xs text-muted-foreground">
                        {active > 0
                          ? `${active} aktiv`
                          : roomDevices.length > 0
                          ? 'Alles aus'
                          : 'Keine Geräte'}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {rooms.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            Noch keine Räume vorhanden. Gehe zu Einstellungen um welche hinzuzufügen.
          </p>
        )}
      </div>
    </div>
  );
}
