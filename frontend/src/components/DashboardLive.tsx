'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, Device, Room } from '@/lib/api';
import { DeviceType } from '@/lib/api';
import { deviceLabels, deviceIcons, isToggleable } from '@/lib/devices';
import { DEVICE_UPDATE_EVENT } from '@/lib/device-events';
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

function StatusValue({ device }: { device: Device }) {
  const type = device.type as DeviceType;
  if (type === 'sensor_temperature') {
    return (
      <p className="text-4xl font-bold mt-1 tabular-nums">
        {device.status !== 'unknown' ? device.status : '–'}
        <span className="text-xl font-medium text-muted-foreground">°C</span>
      </p>
    );
  }
  if (type === 'sensor_humidity') {
    return (
      <p className="text-4xl font-bold mt-1 tabular-nums">
        {device.status !== 'unknown' ? device.status : '–'}
        <span className="text-xl font-medium text-muted-foreground">%</span>
      </p>
    );
  }
  if (type === 'sensor_motion' || type === 'sensor_door') {
    const active = device.status === 'on' || device.status === 'true';
    return (
      <p className={cn('text-2xl font-bold mt-1 tabular-nums', active ? 'text-amber-500' : 'text-muted-foreground')}>
        {active ? 'Aktiv' : 'Ruhig'}
      </p>
    );
  }
  // Schaltbares Gerät
  const isOn = device.status === 'on';
  const Icon = deviceIcons[type] ?? deviceIcons.other;
  return (
    <div className={cn(
      'mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
      isOn ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-muted text-muted-foreground'
    )}>
      <Icon className="h-3 w-3" />
      {isOn ? 'An' : 'Aus'}
    </div>
  );
}

export default function DashboardLive({ initialDevices, rooms }: Props) {
  // null = noch nicht geladen → verhindert Flackern mit veralteten SSR-Daten
  const [devices,    setDevices]    = useState<Device[] | null>(null);
  const [widgetIds,  setWidgetIds]  = useState<number[]>([]);
  const [mounted,    setMounted]    = useState(false);

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

    const interval = setInterval(refresh, 60_000);

    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev ? prev.map(d => d.id === id ? { ...d, status } : d) : prev);
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);

    // Widget-IDs aus localStorage bei Storage-Event (andere Tabs / Settings-Seite)
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIDGETS_KEY) setWidgetIds(loadWidgetIds());
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, [refresh]);

  const loaded = devices !== null;
  const list   = devices ?? [];

  const activeDevices     = list.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
  const toggleableDevices = list.filter(d => isToggleable(d.type as DeviceType)).length;

  // Gewählte Widget-Geräte — nur wenn explizit konfiguriert, kein Auto-Default
  const widgetDevices = loaded && widgetIds.length > 0
    ? widgetIds.map(id => list.find(d => d.id === id)).filter(Boolean) as Device[]
    : [];

  return (
    <div className="space-y-6">

      {/* ── Statistiken ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Aktiv-Kachel */}
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Aktiv</p>
          {loaded ? (
            <>
              <p className="text-4xl font-bold mt-1 tabular-nums">{activeDevices}</p>
              <p className="text-xs text-muted-foreground mt-0.5">von {toggleableDevices} schaltbar</p>
            </>
          ) : (
            <div className="h-10 w-12 bg-muted animate-pulse rounded mt-1" />
          )}
        </div>

        {/* Räume-Kachel */}
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Räume</p>
          <p className="text-4xl font-bold mt-1 tabular-nums">{rooms.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Bereiche</p>
        </div>

        {/* Widget-Kacheln (konfigurierbar) */}
        {loaded
          ? widgetDevices.slice(0, 2).map(s => (
              <div key={s.id} className="rounded-xl border bg-card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                  {s.name}
                </p>
                <StatusValue device={s} />
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {rooms.find(r => r.id === s.room_id)?.name ?? deviceLabels[s.type as DeviceType] ?? ''}
                </p>
              </div>
            ))
          : widgetIds.length > 0
          ? widgetIds.slice(0, 2).map(i => (
              <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
                <div className="h-3 bg-muted rounded w-20 mb-2" />
                <div className="h-10 bg-muted rounded w-16" />
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

      {/* ── Schnellzugriff ──────────────────────────────────────── */}
      {mounted && <QuickAccess initialDevices={loaded ? list : initialDevices} />}

      {/* ── Räume ───────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Räume</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.map(room => {
            const roomDevices = list.filter(d => d.room_id === room.id);
            const active = roomDevices.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
            return (
              <Link key={room.id} href={`/rooms/${room.id}`}>
                <div className={cn(
                  'rounded-xl border p-4 flex flex-col gap-2 min-h-[120px] cursor-pointer',
                  'transition-all hover:bg-accent active:scale-[0.97]',
                  active > 0 ? 'border-green-500/20 bg-green-500/[0.03]' : 'bg-card'
                )}>
                  <span className="text-4xl leading-none select-none">{room.icon ?? '🏠'}</span>
                  <div className="mt-auto">
                    <p className="font-semibold text-sm leading-tight">{room.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {active > 0 && (
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {active > 0
                          ? `${active} an`
                          : roomDevices.length > 0
                          ? 'Alle aus'
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
