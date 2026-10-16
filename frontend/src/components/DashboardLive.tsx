'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { api, Device, DeviceType, Room, Scene, type CalendarEventsResponse, type EnergyOverview, type TransitBoardResponse, type WeatherResponse } from '@/lib/api';
import { countsAsActive, deviceTemperature } from '@/lib/devices';
import { DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { reconcileRemoteDevice, reconcileRemoteStatus } from '@/lib/device-status-hold';
import { getEcho, onEchoReset } from '@/lib/echo';
import { useSmartHomeStore } from '@/store/smarthome';
import { cn } from '@/lib/utils';
import { loadBootstrapSnapshot, saveBootstrapSnapshot, mergeBootstrap, bootstrapHasContent } from '@/lib/bootstrap-snapshot';
import DeviceFieldPanel from '@/components/DeviceFieldPanel';
import { useDashboardLayout, parseFieldSectionId, type DashboardPage, type SectionId } from '@/hooks/useDashboardLayout';
import DashboardActions from '@/components/DashboardActions';
import WeatherWidget from '@/components/WeatherWidget';
import CalendarWidget from '@/components/CalendarWidget';
import TransitWidget from '@/components/TransitWidget';
import EnergyWidget from '@/components/EnergyWidget';
import SpotifyWidget from '@/components/SpotifyWidget';
import { useKiosk } from '@/components/KioskProvider';

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

function ClockWidget({
  time,
  dateReady,
  activeDevices,
  devices,
  kioskMode,
}: {
  time: string;
  dateReady: boolean;
  activeDevices: number;
  devices: Device[];
  kioskMode: boolean;
}) {
  return (
    <div className={cn('flex items-center rounded-2xl border bg-card', kioskMode ? 'gap-3 p-3' : 'gap-4 p-5')}>
      <div className="min-w-0">
        <p className={cn('font-bold tabular-nums leading-none tracking-tight', kioskMode ? 'text-3xl' : 'text-5xl')} suppressHydrationWarning>
          {time || '\u00a0'}
        </p>
        <p className="text-sm text-muted-foreground mt-1" suppressHydrationWarning>
          {dateReady ? getFormattedDate() : '\u00a0'}
        </p>
      </div>

      <div className="flex-1" />

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

      <DashboardActions devices={devices} />
    </div>
  );
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
  const storeRooms = useSmartHomeStore(s => s.rooms);
  const storeDevices = useSmartHomeStore(s => s.devices);
  const storeScenes = useSmartHomeStore(s => s.scenes);

  const [devices,  setDevices]  = useState<Device[]>(initialDevices);
  const [mounted,  setMounted]  = useState(false);
  const [time,     setTime]     = useState('');
  const [running,  setRunning]  = useState<Set<number>>(new Set());
  const [done,     setDone]     = useState<Set<number>>(new Set());
  const [weatherInit, setWeatherInit] = useState(initialWeather);
  const [transitInit, setTransitInit] = useState(initialTransit);
  const [energyInit, setEnergyInit] = useState(initialEnergy);
  const [calendarInit, setCalendarInit] = useState(initialCalendar);
  const [pageIndex, setPageIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const snap = loadBootstrapSnapshot();
    const ssr: Parameters<typeof mergeBootstrap>[1] = {
      rooms, devices: initialDevices, scenes: initialScenes,
      weather: initialWeather, transit: initialTransit, energy: initialEnergy, calendar: initialCalendar,
    };
    const merged = mergeBootstrap(snap, bootstrapHasContent(ssr) ? ssr : snap);
    hydrate(merged);
    saveBootstrapSnapshot(merged);
    if (!initialWeather && merged.weather) setWeatherInit(merged.weather);
    if (!initialTransit && merged.transit) setTransitInit(merged.transit);
    if (!initialEnergy && merged.energy) setEnergyInit(merged.energy);
    if (!initialCalendar && merged.calendar) setCalendarInit(merged.calendar);
    if (merged.devices.length && initialDevices.length === 0) setDevices(merged.devices);
  }, [hydrate, rooms, initialDevices, initialScenes, initialWeather, initialTransit, initialEnergy, initialCalendar]);

  useEffect(() => {
    setMounted(true);

    const updateTime = () =>
      setTime(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
    updateTime();
    const clock = setInterval(updateTime, 1000);

    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status: reconcileRemoteStatus(id, status, d.status) } : d));
      patchDevice(id, { status });
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);

    let echo: ReturnType<typeof getEcho> | null = null;
    const bindEcho = () => {
      try { echo?.leaveChannel('devices'); } catch { /* alte Verbindung */ }
      echo = null;
      try {
        echo = getEcho();
        echo.channel('devices').listen('.device.updated', (data: {
          id: number; status: string; attributes: Record<string, unknown>; last_seen: string;
        }) => {
          setDevices(prev => prev.map(d => d.id === data.id
            ? reconcileRemoteDevice(d, { status: data.status, attributes: data.attributes, last_seen: data.last_seen })
            : d
          ));
          patchDevice(data.id, { status: data.status, attributes: data.attributes, last_seen: data.last_seen });
        });
      } catch (err) {
        echo = null;
        console.warn('[WebSocket] Reverb nicht erreichbar', err);
      }
    };
    bindEcho();
    const offEcho = onEchoReset(bindEcho);

    return () => {
      clearInterval(clock);
      window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
      offEcho();
      if (echo) echo.leaveChannel('devices');
    };
  }, [patchDevice]);

  const list          = storeDevices.length > 0 ? storeDevices : devices;
  const displayRooms  = storeRooms.length > 0 ? storeRooms : rooms;
  const displayScenes = storeScenes.length > 0 ? storeScenes : initialScenes;
  const activeDevices = list.filter(d => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;

  const layout = useDashboardLayout();
  const { kioskMode } = useKiosk();

  const pages: DashboardPage[] = layout.pages.length > 0
    ? layout.pages
    : [{ id: 'home', name: 'Home', sectionOrder: layout.sectionOrder }];

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth || 1;
      const i = Math.round(el.scrollLeft / w);
      setPageIndex(Math.min(pages.length - 1, Math.max(0, i)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [pages.length]);

  const goToPage = useCallback((i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    setPageIndex(i);
  }, []);

  const orderedRooms = useMemo(() => {
    const { roomOrder } = layout;
    if (roomOrder.length === 0) return displayRooms;
    return [...displayRooms].sort((a, b) => {
      const ai = roomOrder.indexOf(a.id);
      const bi = roomOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [displayRooms, layout]);

  const fieldsById = useMemo(
    () => new Map(layout.fields.map(f => [f.id, f])),
    [layout.fields],
  );

  const activateScene = async (scene: Scene) => {
    if (running.has(scene.id)) return;
    setRunning(r => new Set(r).add(scene.id));
    try {
      await api.activateScene(scene.id);
      setDone(d => new Set(d).add(scene.id));
      setTimeout(() => setDone(d => { const n = new Set(d); n.delete(scene.id); return n; }), 2000);
    } finally {
      setRunning(r => { const n = new Set(r); n.delete(scene.id); return n; });
    }
  };

  const renderSection = (sectionId: SectionId, keyPrefix: string) => {
    const key = `${keyPrefix}:${sectionId}`;

    if (sectionId === 'clock') {
      return (
        <ClockWidget
          key={key}
          time={time}
          dateReady={mounted}
          activeDevices={activeDevices}
          devices={list}
          kioskMode={kioskMode}
        />
      );
    }

    if (sectionId === 'weather') return (
      <div key={key}>
        <WeatherWidget initial={weatherInit} />
      </div>
    );

    if (sectionId === 'calendar') return (
      <div key={key}>
        <CalendarWidget initial={calendarInit} />
      </div>
    );

    if (sectionId === 'transit') return (
      <div key={key}>
        <TransitWidget initial={transitInit} />
      </div>
    );

    if (sectionId === 'energy') return (
      <div key={key}>
        <EnergyWidget initial={energyInit} />
      </div>
    );

    if (sectionId === 'spotify') return (
      <div key={key}>
        <SpotifyWidget />
      </div>
    );

    if (sectionId === 'scenes') return displayScenes.length > 0 ? (
      <div key={key} className={cn('flex overflow-x-auto pb-1 -mb-1 scrollbar-none', kioskMode ? 'gap-2' : 'gap-3')}>
        {displayScenes.map(scene => {
          const isRunning = running.has(scene.id);
          const isDone    = done.has(scene.id);
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => activateScene(scene)}
              disabled={isRunning}
              className={cn(
                'flex flex-col items-center gap-2 rounded-2xl border flex-shrink-0',
                kioskMode ? 'p-2 min-w-[88px]' : 'p-4 min-w-[110px]',
                'transition-all duration-200 active:scale-[0.95] cursor-pointer',
                isDone
                  ? 'bg-green-500/15 border-green-400/40 text-green-600 dark:text-green-400'
                  : 'bg-card border-border hover:bg-accent/60',
                isRunning && 'opacity-60 animate-pulse cursor-not-allowed',
              )}
            >
              <span className={cn('leading-none select-none', kioskMode ? 'text-2xl' : 'text-3xl')}>
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
      <div key={key} className={cn('grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5', kioskMode ? 'gap-3' : 'gap-4')}>
        {orderedRooms.map(room => {
          const roomDevices = list.filter(d => d.room_id === room.id);
          const active      = roomDevices.filter(d => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;
          const tempDeviceId = layout.roomTemperatureDeviceIds?.[String(room.id)];
          const tempDevice = tempDeviceId ? list.find(d => d.id === tempDeviceId) : undefined;
          const roomTemp = tempDevice ? deviceTemperature(tempDevice) : null;
          return (
            <Link key={room.id} href={`/rooms/${room.id}`} prefetch>
              <div className={cn(
                'rounded-2xl border flex flex-col cursor-pointer',
                kioskMode ? 'p-3 gap-2 min-h-[120px]' : 'p-5 gap-3 min-h-[165px]',
                'transition-all duration-300 ease-in-out active:scale-[0.97]',
                active > 0
                  ? 'bg-amber-500/15 border-amber-400/40 shadow-sm'
                  : 'bg-card border-border hover:bg-accent/40'
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className={cn(
                    'rounded-xl flex items-center justify-center select-none',
                    kioskMode ? 'w-12 h-12 text-2xl' : 'w-14 h-14 text-3xl',
                    active > 0 ? 'bg-amber-500/20' : 'bg-muted'
                  )}>
                    {room.icon ?? '🏠'}
                  </div>
                  {roomTemp != null && (
                    <span className="text-lg font-semibold tabular-nums leading-none pt-1 text-foreground">
                      {roomTemp.toFixed(1)}°
                    </span>
                  )}
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

        {displayRooms.length === 0 && (
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
          key={key}
          title={field.name}
          deviceIds={field.deviceIds}
          initialDevices={list}
        />
      );
    }

    return null;
  };

  const multiPage = pages.length > 1;

  return (
    <div className={cn(multiPage && 'pb-10')}>
      <div
        ref={scrollerRef}
        className={cn(
          multiPage && 'flex overflow-x-auto snap-x snap-mandatory scrollbar-none overscroll-x-contain',
        )}
      >
        {pages.map(page => (
          <section
            key={page.id}
            className={cn(
              'dash-sections',
              kioskMode ? 'gap-2' : 'gap-4',
              multiPage && 'w-full min-w-full shrink-0 snap-start',
            )}
          >
            {page.sectionOrder.map(id => {
              const node = renderSection(id, page.id);
              if (!node) return null;
              const span = id === 'clock' || id === 'rooms' || id === 'scenes';
              return span
                ? <div key={`${page.id}:${id}:span`} className="dash-span">{node}</div>
                : node;
            })}
          </section>
        ))}
      </div>

      {multiPage && (
        <div
          data-slot="page-dots"
          className={cn(
            'fixed inset-x-0 bottom-4 z-40 flex justify-center pointer-events-none',
          )}
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-background/85 backdrop-blur-md border px-3 py-1.5 shadow-sm">
            {pages.map((page, i) => (
              <button
                key={page.id}
                type="button"
                onClick={() => goToPage(i)}
                aria-label={page.name}
                className={cn(
                  'rounded-full transition-all cursor-pointer',
                  i === pageIndex
                    ? 'h-2.5 w-6 bg-primary'
                    : 'h-2.5 w-2.5 bg-muted-foreground/40 hover:bg-muted-foreground/70',
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
