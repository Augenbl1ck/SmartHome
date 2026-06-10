'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { api, Device } from '@/lib/api';
import { deviceIcons, isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { Star, Bluetooth, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shellyBle } from '@/lib/bluetooth';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';

const STORAGE_KEY = 'smarthome_favorites';

function loadFavorites(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFavorites(ids: number[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function isBle(device: Device): boolean {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

interface Props { initialDevices: Device[] }

export default function QuickAccess({ initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [toggling, setToggling] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // Zähler erhöht sich bei jedem BLE-State-Change → erzwingt Re-Render mit frischen isConnected()-Werten
  const [, dispatch] = useReducer((x: number) => x + 1, 0);
  const forceUpdate = useCallback(() => dispatch(0), []);

  useEffect(() => {
    setFavorites(loadFavorites());

    const bleDevices = initialDevices.filter(isBle);
    for (const d of bleDevices) {
      shellyBle.onStateChange(d.id, forceUpdate);
    }

    setMounted(true);
    return () => { for (const d of bleDevices) shellyBle.offStateChange(d.id); };
  }, [initialDevices]);

  // Gerätezustand-Updates von anderen Komponenten empfangen
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);
    return () => window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
  }, []);

  const toggle = async (device: Device) => {
    if (!isToggleable(device.type as DeviceType)) return;

    const ble = isBle(device);
    // Direkt am Singleton: immer aktuell, kein veralteter State
    if (ble && !shellyBle.isConnected(device.id)) {
      setError(`"${device.name}" ist nicht verbunden — bitte zuerst im Raum verbinden.`);
      return;
    }

    setError(null);
    setToggling(t => new Set(t).add(device.id));
    const newStatus = device.status === 'on' ? 'off' : 'on';
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: newStatus } : d));
    try {
      if (ble) {
        await shellyBle.switchSet(device.id, newStatus === 'on');
      }
      const updated = await api.toggleDevice(device.id);
      setDevices(prev => prev.map(d => d.id === device.id ? updated : d));
      emitDeviceUpdate(device.id, newStatus);
    } catch (err) {
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: device.status } : d));
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Fehler bei "${device.name}": ${msg}`);
    } finally {
      setToggling(t => { const n = new Set(t); n.delete(device.id); return n; });
    }
  };

  const favoriteDevices = mounted
    ? devices.filter(d => favorites.includes(d.id) && isToggleable(d.type as DeviceType))
    : [];

  if (!mounted) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Schnellzugriff
        </p>
        <span className="text-[11px] text-muted-foreground">
          Stern in Raumansicht zum Anheften
        </span>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive flex-1">{error}</p>
          <button onClick={() => setError(null)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground shrink-0">✕</button>
        </div>
      )}

      {favoriteDevices.length === 0 ? (
        <div className="rounded-xl border border-dashed p-5 text-center text-muted-foreground">
          <Star className="h-5 w-5 mx-auto mb-1 opacity-40" />
          <p className="text-xs">Noch keine Favoriten. Tippe in einem Raum auf ⭐, um Geräte hier anzuheften.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {favoriteDevices.map(device => {
            const isOn = device.status === 'on';
            const isRunning = toggling.has(device.id);
            const ble = isBle(device);
            // Live-Check direkt am Singleton (kein State-Cache)
            const connected = !ble || shellyBle.isConnected(device.id);
            const Icon = deviceIcons[device.type as DeviceType];
            return (
              <button
                key={device.id}
                onClick={() => toggle(device)}
                disabled={isRunning}
                className={cn(
                  'cursor-pointer rounded-xl border p-3 flex items-center gap-2 text-left transition-all active:scale-95',
                  isOn && connected ? 'bg-green-500/10 border-green-500/30' : 'bg-card',
                  isRunning && 'opacity-50'
                )}
              >
                <div className={cn(
                  'h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-colors',
                  isOn && connected ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                )}>
                  {Icon && <Icon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{device.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    {ble && <Bluetooth className={cn('h-3 w-3 shrink-0', connected ? 'text-blue-500' : '')} />}
                    {ble && !connected ? 'Nicht verbunden' : isOn ? 'An' : 'Aus'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
