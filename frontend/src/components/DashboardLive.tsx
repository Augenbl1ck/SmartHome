'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api, Device, DeviceType, Room, Scene, type CalendarEventsResponse, type EnergyOverview, type TransitBoardResponse, type WeatherResponse } from '@/lib/api';
import { countsAsActive } from '@/lib/devices';
import { DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { getEcho } from '@/lib/echo';
import { useSmartHomeStore } from '@/store/smarthome';
import { cn } from '@/lib/utils';
import DeviceFieldPanel from '@/components/DeviceFieldPanel';
import { useDashboardLayout, parseFieldSectionId, type SectionId } from '@/hooks/useDashboardLayout';
import DashboardActions from '@/components/DashboardActions';
import WeatherWidget from '@/components/WeatherWidget';
import CalendarWidget from '@/components/CalendarWidget';
import TransitWidget from '@/components/TransitWidget';
import EnergyWidget from '@/components/EnergyWidget';
import SpotifyWidget from '@/components/SpotifyWidget';

interface Props {
  initialDevices: Device[];
  rooms: Room[];
  initialScenes: Scene[];
  initialCalendar?: CalendarEventsResponse | null;
  initialWeather?: WeatherResponse | null;
  initialTransit?: TransitBoardResponse | null;
  initialEnergy?: EnergyOverview | null;
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function DashboardLive({
  initialDevices,
  rooms,
  initialScenes,
  initialCalendar = null,
  initialWeather = null,
  initialTransit = null,
  initialEnergy = null,
}: Props) {
  const hydrate = useSmartHomeStore(s => s.hydrate);
  const patchDevice = useSmartHomeStore(s => s.patchDevice);

  // Server-Daten sofort nutzen → keine Farbverzögerung beim ersten Render
  const [devices,  setDevices]  = useState<Device[]>(initialDevices);
  const [mounted,  setMounted]  = useState(false);
  const [time,     setTime]     = useState('');
  const [running,  setRunning]  = useState<Set<number>>(new Set());
  const [done,     setDone]     = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.getDevices();
      setDevices(fresh);
      useSmartHomeStore.getState().hydrate({ devices: fresh });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    hydrate({ rooms, devices: initialDevices, scenes: initialScenes });
  }, [hydrate, rooms, initialDevices, initialScenes]);

  useEffect(() => {
    setMounted(true);

    // Echtzeit-Uhr
    const updateTime = () =>
      setTime(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
    updateTime();
    const clock = setInterval(updateTime, 1000);

    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);

    const interval = setInterval(refresh, 5 * 60_000);

    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);

    // WebSocket via Laravel Reverb
    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('devices').listen('.device.updated', (data: {
        id: number; status: string; attributes: Record<string, unknown>; last_seen: string;
      }) => {
        setDevices(prev => prev.map(d => d.id === data.id
          ? { ...d, status: data.status, attributes: data.attributes, last_seen: data.last_seen }
          : d
        ));
        patchDevice(data.id, { status: data.status, attributes: data.attributes, last_seen: data.last_seen });
      });
    } catch (err) {
      console.warn('[WebSocket] Reverb nicht erreichbar, nur Polling aktiv', err);
    }

    return () => {
      clearInterval(clock);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
      if (echo) echo.leaveChannel('devices');
    };
  }, [refresh]);

  const list          = devices;
  const activeDevices = list.filter(d => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;

  const layout = useDashboardLayout();

  const orderedRooms = useMemo(() => {
    const { roomOrder } = layout;
    if (roomOrder.length === 0) return rooms;
    return [...rooms].sort((a, b) => {
      const ai = roomOrder.indexOf(a.id);
      const bi = roomOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [rooms, layout]);

  const sectionOrder: SectionId[] = layout.sectionOrder.length > 0
    ? layout.sectionOrder
    : ['weather', 'calendar', 'transit', 'energy', 'spotify', 'scenes', 'rooms'];
  const hiddenSections = new Set(layout.hiddenSections);
  const fieldsById = useMemo(
    () => new Map(layout.fields.map(f => [f.id, f])),
    [layout.fields],
  );

  const activateScene = async (scene: Scene) => {
    if (running.has(scene.id)) return;
    setRunning(r => new Set(r).add(scene.id));
    try {
      await api.activateScene(scene.id);
      await refresh();
      setDone(d => new Set(d).add(scene.id));
      setTimeout(() => setDone(d => { const n = new Set(d); n.delete(scene.id); return n; }), 2000);
    } finally {
      setRunning(r => { const n = new Set(r); n.delete(scene.id); return n; });
    }
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── Panel-Header: Uhr + Status + Action ─────────────────── */}
      <div className="flex items-center gap-4 rounded-2xl border bg-card p-5">
        {/* Uhr + Datum — suppressHydrationWarning: Server rendert leer, Client überschreibt sofort */}
        <div className="min-w-0">
          <p className="text-5xl font-bold tabular-nums leading-none tracking-tight" suppressHydrationWarning>
            {time || '\u00a0'}
          </p>
          <p className="text-sm text-muted-foreground mt-1" suppressHydrationWarning>
            {mounted ? getFormattedDate() : '\u00a0'}
          </p>
        </div>

        <div className="flex-1" />

        {/* Aktiv-Badge — immer sichtbar (Server-Daten vorhanden) */}
        <div className={cn(
            'flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors',
            activeDevices > 0
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground'
          )}>
            <span className={cn(
              'h-2 w-2 rounded-full',
              activeDevices > 0 ? 'bg-amber-500' : 'bg-muted-foreground/40'
            )} />
            {activeDevices > 0 ? `${activeDevices} aktiv` : 'Alles aus'}
          </div>

        {/* Alle ausschalten */}
        <DashboardActions devices={list} />
      </div>

      {sectionOrder.map(sectionId => {
        if (hiddenSections.has(sectionId)) return null;

        if (sectionId === 'weather') return (
          <div key="weather">
            <WeatherWidget initial={initialWeather} />
          </div>
        );

        if (sectionId === 'calendar') return (
          <div key="calendar">
            <CalendarWidget initial={initialCalendar} />
          </div>
        );

        if (sectionId === 'transit') return (
          <div key="transit">
            <TransitWidget initial={initialTransit} />
          </div>
        );

        if (sectionId === 'energy') return (
          <div key="energy">
            <EnergyWidget initial={initialEnergy} />
          </div>
        );

        if (sectionId === 'spotify') return (
          <div key="spotify">
            <SpotifyWidget />
          </div>
        );

        if (sectionId === 'scenes') return initialScenes.length > 0 ? (
          <div key="scenes" className="flex gap-3 overflow-x-auto pb-1 -mb-1 scrollbar-none">
            {initialScenes.map(scene => {
              const isRunning = running.has(scene.id);
              const isDone    = done.has(scene.id);
              return (
                <button
                  key={scene.id}
                  onClick={() => activateScene(scene)}
                  disabled={isRunning}
                  className={cn(
                    'flex-shrink-0 flex flex-col items-center gap-2 rounded-2xl border p-4 min-w-[110px]',
                    'transition-all duration-200 active:scale-[0.95] cursor-pointer',
                    isDone
                      ? 'bg-green-500/15 border-green-400/40 text-green-600 dark:text-green-400'
                      : 'bg-card border-border hover:bg-accent/60',
                    isRunning && 'opacity-60 animate-pulse cursor-not-allowed',
                  )}
                >
                  <span className="text-3xl leading-none select-none">
                    {isDone ? '✓' : scene.icon}
                  </span>
                  <span className="text-xs font-semibold text-center leading-tight line-clamp-2 w-full">
                    {isDone ? 'Aktiviert' : scene.name}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null;

        if (sectionId === 'rooms') return (
          <div key="rooms" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {orderedRooms.map(room => {
              const roomDevices = list.filter(d => d.room_id === room.id);
              const active      = roomDevices.filter(d => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;
              return (
                <Link key={room.id} href={`/rooms/${room.id}`} prefetch>
                  <div className={cn(
                    'rounded-2xl border p-5 flex flex-col gap-3 min-h-[165px] cursor-pointer',
                    'transition-all duration-300 ease-in-out active:scale-[0.97]',
                    active > 0
                      ? 'bg-amber-500/15 border-amber-400/40 shadow-sm'
                      : 'bg-card border-border hover:bg-accent/40'
                  )}>
                    <div className={cn(
                      'w-14 h-14 rounded-xl flex items-center justify-center text-3xl select-none',
                      active > 0 ? 'bg-amber-500/20' : 'bg-muted'
                    )}>
                      {room.icon ?? '🏠'}
                    </div>
                    <div className="mt-auto">
                      <p className="font-semibold text-base leading-tight">{room.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={cn(
                          'h-2 w-2 rounded-full transition-colors',
                          active > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30'
                        )} />
                        <p className="text-sm text-muted-foreground">
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

            {rooms.length === 0 && (
              <p className="text-muted-foreground text-sm col-span-full py-12 text-center">
                Noch keine Räume. Gehe zu Einstellungen um welche hinzuzufügen.
              </p>
            )}
          </div>
        );

        const fieldId = parseFieldSectionId(sectionId);
        if (fieldId && mounted) {
          const field = fieldsById.get(fieldId);
          if (!field || field.deviceIds.length === 0) return null;
          return (
            <DeviceFieldPanel
              key={sectionId}
              title={field.name}
              deviceIds={field.deviceIds}
              initialDevices={list}
            />
          );
        }

        return null;
      })}

    </div>
  );
}
