'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Timer } from 'lucide-react';
import { api, Device, DeviceType, Room, Scene, type CalendarEventsResponse, type EnergyOverview, type TransitBoardResponse, type WeatherResponse } from '@/lib/api';
import { countsAsActive, deviceTemperature } from '@/lib/devices';
import { DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { getEcho } from '@/lib/echo';
import { useSmartHomeStore } from '@/store/smarthome';
import { cn } from '@/lib/utils';
import { loadBootstrapSnapshot, saveBootstrapSnapshot, mergeBootstrap, bootstrapHasContent } from '@/lib/bootstrap-snapshot';
import DeviceFieldPanel from '@/components/DeviceFieldPanel';
import { useDashboardLayout, parseFieldSectionId, type SectionId } from '@/hooks/useDashboardLayout';
import DashboardActions from '@/components/DashboardActions';
import WeatherWidget from '@/components/WeatherWidget';
import CalendarWidget from '@/components/CalendarWidget';
import TransitWidget from '@/components/TransitWidget';
import EnergyWidget from '@/components/EnergyWidget';
import SpotifyWidget from '@/components/SpotifyWidget';
import SceneDelayDialog, { formatDelayMinutes } from '@/components/SceneDelayDialog';
import { toast } from 'sonner';

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
  const [delayScene, setDelayScene] = useState<Scene | null>(null);

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
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);

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
      console.warn('[WebSocket] Reverb nicht erreichbar', err);
    }

    return () => {
      clearInterval(clock);
      window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
      if (echo) echo.leaveChannel('devices');
    };
  }, [patchDevice]);

  const list          = storeDevices.length > 0 ? storeDevices : devices;
  const displayRooms  = storeRooms.length > 0 ? storeRooms : rooms;
  const displayScenes = storeScenes.length > 0 ? storeScenes : initialScenes;
  const activeDevices = list.filter(d => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;

  const layout = useDashboardLayout();

  const orderedRooms = useMemo(() => {
    const { roomOrder } = layout;
    if (roomOrder.length === 0) return displayRooms;
    return [...displayRooms].sort((a, b) => {
      const ai = roomOrder.indexOf(a.id);
      const bi = roomOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [displayRooms, layout]);

  const sectionOrder: SectionId[] = layout.sectionOrder.length > 0
    ? layout.sectionOrder
    : ['weather', 'calendar', 'transit', 'energy', 'spotify', 'scenes', 'rooms'];
  const hiddenSections = new Set(layout.hiddenSections);
  const fieldsById = useMemo(
    () => new Map(layout.fields.map(f => [f.id, f])),
    [layout.fields],
  );

  const activateScene = async (scene: Scene, delayMinutes?: number) => {
    if (running.has(scene.id)) return;
    if (delayMinutes && delayMinutes > 0) {
      try {
        await api.activateScene(scene.id, { delay_minutes: delayMinutes });
        toast.success(`${scene.name} startet in ${formatDelayMinutes(delayMinutes)}`);
      } catch {
        toast.error(`${scene.name} konnte nicht geplant werden`);
      }
      return;
    }
    setRunning(r => new Set(r).add(scene.id));
    try {
      await api.activateScene(scene.id);
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
            <WeatherWidget initial={weatherInit} />
          </div>
        );

        if (sectionId === 'calendar') return (
          <div key="calendar">
            <CalendarWidget initial={calendarInit} />
          </div>
        );

        if (sectionId === 'transit') return (
          <div key="transit">
            <TransitWidget initial={transitInit} />
          </div>
        );

        if (sectionId === 'energy') return (
          <div key="energy">
            <EnergyWidget initial={energyInit} />
          </div>
        );

        if (sectionId === 'spotify') return (
          <div key="spotify">
            <SpotifyWidget />
          </div>
        );

        if (sectionId === 'scenes') return displayScenes.length > 0 ? (
          <div key="scenes" className="flex gap-3 overflow-x-auto pb-1 -mb-1 scrollbar-none">
            {displayScenes.map(scene => {
              const isRunning = running.has(scene.id);
              const isDone    = done.has(scene.id);
              return (
                <div key={scene.id} className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => activateScene(scene)}
                    disabled={isRunning}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-2xl border p-4 min-w-[110px] pr-10',
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
                  <button
                    type="button"
                    onClick={() => setDelayScene(scene)}
                    disabled={isRunning}
                    className="cursor-pointer absolute top-1.5 right-1.5 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    aria-label="Ausführen in…"
                  >
                    <Timer className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null;

        if (sectionId === 'rooms') return (
          <div key="rooms" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {orderedRooms.map(room => {
              const roomDevices = list.filter(d => d.room_id === room.id);
              const active      = roomDevices.filter(d => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;
              const tempDeviceId = layout.roomTemperatureDeviceIds?.[String(room.id)];
              const tempDevice = tempDeviceId ? list.find(d => d.id === tempDeviceId) : undefined;
              const roomTemp = tempDevice ? deviceTemperature(tempDevice) : null;
              return (
                <Link key={room.id} href={`/rooms/${room.id}`} prefetch>
                  <div className={cn(
                    'rounded-2xl border p-5 flex flex-col gap-3 min-h-[165px] cursor-pointer',
                    'transition-all duration-300 ease-in-out active:scale-[0.97]',
                    active > 0
                      ? 'bg-amber-500/15 border-amber-400/40 shadow-sm'
                      : 'bg-card border-border hover:bg-accent/40'
                  )}>
                    <div className="flex items-start justify-between gap-2">
                      <div className={cn(
                        'w-14 h-14 rounded-xl flex items-center justify-center text-3xl select-none',
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
              key={sectionId}
              title={field.name}
              deviceIds={field.deviceIds}
              initialDevices={list}
            />
          );
        }

        return null;
      })}

      <SceneDelayDialog
        open={delayScene != null}
        sceneName={delayScene?.name ?? ''}
        onClose={() => setDelayScene(null)}
        onConfirm={(minutes) => {
          const scene = delayScene;
          setDelayScene(null);
          if (scene) void activateScene(scene, minutes);
        }}
      />
    </div>
  );
}
