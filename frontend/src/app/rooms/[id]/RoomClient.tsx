'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Device, Room } from '@/lib/api';
import { shellyBle, BleState } from '@/lib/bluetooth';
import { deviceIcons, deviceLabels, isSensor, isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { ArrowLeft, Bluetooth, BluetoothConnected, BluetoothOff, Power, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeviceHistory from '@/components/DeviceHistory';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import BleScanDialog from '@/components/BleScanDialog';

interface Props {
  room: Room;
  initialDevices: Device[];
}

function isBleDevice(device: Device): boolean {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

/** Hat das Gerät eine MAC-Adresse? → BLE Bridge auf dem Server, kein Browser-BLE nötig */
function hasMac(device: Device): boolean {
  return !!(device.attributes?.ble_address as string | undefined)?.trim();
}

const FAV_KEY = 'smarthome_favorites';

function loadFavs(): number[] {
  try { const r = localStorage.getItem(FAV_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function saveFavs(ids: number[]) { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); }

export default function RoomClient({ room, initialDevices }: Props) {
  const router = useRouter();
  const [devices, setDevices]     = useState(initialDevices);
  const [pending, setPending]     = useState<Set<number>>(new Set());
  const [bleStates, setBleStates] = useState<Map<number, BleState>>(new Map());
  const [bleError, setBleError]   = useState<string | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [scanDevice, setScanDevice] = useState<Device | null>(null);

  // Beim Mount immer frische Gerätedaten laden (wichtig nach Navigation)
  useEffect(() => {
    api.getDevices(room.id).then(fresh => setDevices(fresh)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => { setFavorites(loadFavs()); }, []);

  // Gerätezustand-Updates von anderen Komponenten empfangen
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);
    return () => window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
  }, []);

  const toggleFav = (id: number) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id];
      saveFavs(next);
      return next;
    });
  };

  // BLE-State-Listener registrieren + Auto-Connect beim Laden
  useEffect(() => {
    const bleDevices = initialDevices.filter(isBleDevice);
    for (const d of bleDevices) {
      shellyBle.onStateChange(d.id, (state) =>
        setBleStates((prev) => new Map(prev).set(d.id, state))
      );
      // Automatisch verbinden wenn Gerät bereits gekoppelt wurde
      shellyBle.tryAutoConnect(d.id);
    }
    return () => { for (const d of bleDevices) shellyBle.offStateChange(d.id); };
  }, [initialDevices]);

  const getBleState = (id: number): BleState =>
    bleStates.get(id) ?? (shellyBle.isConnected(id) ? 'connected' : 'disconnected');

  const handleBlePair = async (device: Device) => {
    // Hat keine MAC und BLE Bridge verfügbar → Scan starten
    setScanDevice(device);
  };

  const handleBleForget = (device: Device) => {
    shellyBle.forget(device.id);
  };

  const handleToggle = async (device: Device) => {
    if (pending.has(device.id)) return;
    const newStatus = device.status === 'on' ? 'off' : 'on';
    setPending((p) => new Set(p).add(device.id));
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, status: newStatus } : d))
    );
    try {
      if (isBleDevice(device) && shellyBle.isSupported()) {
        // Web Bluetooth immer versuchen wenn im Browser (Chrome/Windows).
        // Auf dem Pi ist isSupported() false → BLE Bridge übernimmt server-seitig.
        try {
          await shellyBle.switchSet(device.id, newStatus === 'on');
        } catch {
          // Nicht verbunden oder BLE nicht verfügbar — Server (BLE Bridge) übernimmt.
        }
      }
      // Server-API (MQTT / HTTP / BLE Bridge via MAC)
      const updated = await api.toggleDevice(device.id);
      setDevices((prev) => prev.map((d) => (d.id === device.id ? updated : d)));
      emitDeviceUpdate(device.id, newStatus);
    } catch (err) {
      setDevices((prev) => prev.map((d) => (d.id === device.id ? device : d)));
      const msg = err instanceof Error ? err.message : String(err);
      setBleError(msg);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(device.id); return n; });
    }
  };

  const activeCount = devices.filter((d) => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
  const toggleableCount = devices.filter((d) => isToggleable(d.type as DeviceType)).length;

  return (
    <div className="space-y-5">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="cursor-pointer h-10 w-10 rounded-full flex items-center justify-center bg-muted hover:bg-accent transition-colors shrink-0 active:scale-95"
          aria-label="Zurück"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold leading-tight">
            {room.icon} {room.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} von ${toggleableCount} aktiv`
              : `${devices.length} Gerät${devices.length !== 1 ? 'e' : ''}`}
          </p>
        </div>
      </div>

      {/* ── BLE-Fehler ────────────────────────────────────────────── */}
      {bleError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-semibold text-destructive">Bluetooth-Fehler</p>
          <p className="text-xs text-muted-foreground mt-0.5">{bleError}</p>
          <button
            className="cursor-pointer mt-2 text-xs text-destructive underline"
            onClick={() => setBleError(null)}
          >
            Schließen
          </button>
        </div>
      )}

      {/* ── Geräte-Grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {devices.map((device) => {
          const Icon        = deviceIcons[device.type as DeviceType] ?? deviceIcons.other;
          const label       = deviceLabels[device.type as DeviceType] ?? 'Gerät';
          const toggleable  = isToggleable(device.type as DeviceType);
          const sensor      = isSensor(device.type as DeviceType);
          const ble         = isBleDevice(device);
          const useBridge   = ble && hasMac(device);   // MAC → BLE Bridge, kein Browser-BLE
          const useBleWeb   = ble && !useBridge;       // kein MAC → Web Bluetooth
          const bleState    = getBleState(device.id);
          const bleConn     = bleState === 'connected';
          const isOn        = device.status === 'on';
          const isPending   = pending.has(device.id);
          // BLE Bridge: Power-Button immer klickbar (Server übernimmt)
          // Web BLE: Power-Button immer klickbar (switchSet reconnectet automatisch)
          const isDisabled  = isPending;

          return (
            <div
              key={device.id}
              className={cn(
                'relative rounded-xl border p-3 transition-all min-h-[96px]',
                isOn && !sensor
                  ? 'border-green-500/25 bg-green-500/[0.04]'
                  : 'border-border bg-card'
              )}
            >
              {/* Favoriten-Stern oben links */}
              <button
                onClick={() => toggleFav(device.id)}
                className="cursor-pointer absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded-full hover:bg-accent transition-colors z-10"
                aria-label="Favorit"
              >
                <Star className={cn('h-3.5 w-3.5', favorites.includes(device.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
              </button>

              {/* Icon + Name — rechts Platz für Power-Button */}
              <div className={cn('flex items-start gap-2', toggleable && !sensor && 'pr-12')}>
                <div className={cn(
                  'h-8 w-8 rounded-xl flex items-center justify-center shrink-0',
                  isOn && !sensor
                    ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                    : 'bg-muted text-muted-foreground'
                )}>
                  <Icon style={{ width: 16, height: 16 }} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold leading-tight truncate">{device.name}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>

              {/* Sensor-Wert */}
              {sensor && (
                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {device.status !== 'unknown' ? device.status : '–'}
                  <span className="text-sm font-medium text-muted-foreground ml-0.5">
                    {device.type === 'sensor_temperature' && '°C'}
                    {device.type === 'sensor_humidity' && '%'}
                  </span>
                </p>
              )}

              {/* BLE-Chip — nur anzeigen wenn Browser Web Bluetooth (kein MAC) */}
              {useBleWeb && (
                <div className="mt-2">
                  {bleState === 'connected' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 text-xs text-blue-500 font-medium py-1 px-2 rounded-full bg-blue-500/10">
                        <BluetoothConnected className="h-3 w-3 shrink-0" />
                        {shellyBle.getPairedName(device.id) ?? 'Verbunden'}
                      </span>
                      <button
                        onClick={() => handleBleForget(device)}
                        className="cursor-pointer text-xs text-muted-foreground hover:text-destructive transition-colors px-1"
                        title="Kopplung aufheben"
                      >
                        ✕
                      </button>
                    </div>
                  ) : bleState === 'connecting' ? (
                    <span className="w-fit flex items-center gap-1 text-xs text-muted-foreground py-1 px-2 rounded-full bg-muted">
                      <Bluetooth className="h-3 w-3 shrink-0 animate-pulse" />
                      Verbinde…
                    </span>
                  ) : (
                    <button
                      onClick={() => handleBlePair(device)}
                      className={cn(
                        'cursor-pointer w-fit flex items-center gap-1 text-xs font-medium py-1 px-2 rounded-full transition-colors',
                        bleState === 'error'
                          ? 'text-destructive bg-destructive/10 hover:bg-destructive/20'
                          : shellyBle.getPairedName(device.id)
                          ? 'text-blue-500 bg-blue-500/10 hover:bg-blue-500/20'
                          : 'text-muted-foreground bg-muted hover:bg-accent'
                      )}
                    >
                      {bleState === 'error'
                        ? <BluetoothOff className="h-3 w-3 shrink-0" />
                        : <Bluetooth className="h-3 w-3 shrink-0" />}
                      {bleState === 'error'
                        ? 'Erneut verbinden'
                        : shellyBle.getPairedName(device.id)
                        ? 'Neu verbinden'
                        : 'Koppeln'}
                    </button>
                  )}
                </div>
              )}

              {/* BLE-Bridge-Badge — wenn MAC gesetzt, als Info */}
              {useBridge && (
                <div className="mt-2">
                  <span className="w-fit flex items-center gap-1 text-xs text-muted-foreground py-1 px-2 rounded-full bg-muted">
                    <Bluetooth className="h-3 w-3 shrink-0" />
                    BLE Bridge
                  </span>
                </div>
              )}

              {/* Geräteverlauf */}
              {toggleable && !sensor && (
                <div className="mt-2">
                  <DeviceHistory deviceId={device.id} deviceName={device.name} />
                </div>
              )}

              {/* Power-Button (absolut unten rechts) */}
              {toggleable && !sensor && (
                <button
                  onClick={() => handleToggle(device)}
                  disabled={isDisabled}
                  aria-label={isOn ? 'Ausschalten' : 'Einschalten'}
                  className={cn(
                    'absolute bottom-3 right-3 h-10 w-10 rounded-full',
                    'flex items-center justify-center transition-all',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background',
                    'active:scale-90',
                    isOn
                      ? 'bg-green-500 text-white shadow-md shadow-green-500/30 hover:bg-green-600'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
                    isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                    isPending && 'animate-pulse'
                  )}
                >
                  <Power style={{ width: 16, height: 16 }} />
                </button>
              )}
            </div>
          );
        })}

        {devices.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-full py-10 text-center">
            Keine Geräte in diesem Raum.
          </p>
        )}
      </div>

      {/* BLE-Scan-Dialog */}
      {scanDevice && (
        <BleScanDialog
          device={scanDevice}
          onSaved={updated => {
            setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
            setScanDevice(null);
          }}
          onClose={() => setScanDevice(null)}
        />
      )}
    </div>
  );
}


