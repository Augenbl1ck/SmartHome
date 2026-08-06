'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Device, Room } from '@/lib/api';
import { shellyBle, BleState } from '@/lib/bluetooth';
import { deviceIcons, isSensor, isToggleable, getDeviceColors, getDeviceEmoji } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { ArrowLeft, Bluetooth, BluetoothConnected, BluetoothOff, Star, ChevronUp, ChevronDown, Square, Minus, Plus, PowerOff, Loader2, Power } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeviceHistory from '@/components/DeviceHistory';
import SensorChart from '@/components/SensorChart';
import ShellyPlugPanel from '@/components/ShellyPlugPanel';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { getEcho } from '@/lib/echo';
import BleScanDialog from '@/components/BleScanDialog';

// Tile-Hintergrundfarbe wenn Gerät aktiv ist (nach Typ)
function getActiveTileClasses(device: Device): string {
  const type = device.type as DeviceType;
  const customColor = device.attributes?.custom_color as string | undefined;
  if (customColor) {
    const colorMap: Record<string, string> = {
      amber: 'bg-amber-500/15 border-amber-400/40', blue: 'bg-blue-500/15 border-blue-400/40',
      green: 'bg-green-500/15 border-green-400/40', red: 'bg-red-500/15 border-red-400/40',
      violet: 'bg-violet-500/15 border-violet-400/40', pink: 'bg-pink-500/15 border-pink-400/40',
      cyan: 'bg-cyan-500/15 border-cyan-400/40', orange: 'bg-orange-500/15 border-orange-400/40',
      teal: 'bg-teal-500/15 border-teal-400/40', sky: 'bg-sky-500/15 border-sky-400/40',
      emerald: 'bg-emerald-500/15 border-emerald-400/40', rose: 'bg-rose-500/15 border-rose-400/40',
    };
    if (colorMap[customColor]) return colorMap[customColor];
  }
  switch (type) {
    case 'light': case 'dimmer': case 'rgb': case 'led':
      return 'bg-amber-500/15 border-amber-400/40 shadow-sm';
    case 'plug': case 'switch': case 'energy_meter':
      return 'bg-blue-500/15 border-blue-400/40 shadow-sm';
    case 'fan':
      return 'bg-cyan-500/15 border-cyan-400/40 shadow-sm';
    case 'thermostat':
      return 'bg-orange-500/15 border-orange-400/40 shadow-sm';
    case 'valve':
      return 'bg-teal-500/15 border-teal-400/40 shadow-sm';
    default:
      return 'bg-primary/10 border-primary/30 shadow-sm';
  }
}

// Relativer Zeitstempel für last_seen
function formatLastSeen(lastSeen: string | null | undefined): string | null {
  if (!lastSeen) return null;
  const diffSec = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
  if (diffSec < 60)   return 'gerade eben';
  if (diffSec < 3600) return `vor ${Math.floor(diffSec / 60)} Min.`;
  if (diffSec < 86400) return `vor ${Math.floor(diffSec / 3600)} Std.`;
  return `vor ${Math.floor(diffSec / 86400)} Tagen`;
}

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
  const [turningOff, setTurningOff] = useState(false);

  // Setpoints + Dimmer-Level sofort aus Server-Daten (kein Flicker)
  const [setpoints, setSetpoints] = useState<Map<number, number>>(() => {
    const m = new Map<number, number>();
    for (const d of initialDevices) {
      if (d.type === 'thermostat') {
        const sp = Number(d.attributes?.setpoint ?? d.status);
        m.set(d.id, isNaN(sp) ? 20 : sp);
      }
    }
    return m;
  });
  const [dimmerLevels, setDimmerLevels] = useState<Map<number, number>>(() => {
    const m = new Map<number, number>();
    for (const d of initialDevices) {
      if (['dimmer', 'rgb', 'led'].includes(d.type)) {
        const lv = Number(d.attributes?.brightness ?? (d.status !== 'on' && d.status !== 'off' ? d.status : 50));
        m.set(d.id, isNaN(lv) ? 50 : Math.min(100, Math.max(0, lv)));
      }
    }
    return m;
  });

  // Geräte nur bei Focus neu laden (SSR-Daten sind bereits aktuell)
  useEffect(() => {
    const refresh = () => {
      api.getDevices(room.id).then(fresh => {
        setDevices(fresh);
        setSetpoints(prev => {
          const m = new Map(prev);
          for (const d of fresh) {
            if (d.type === 'thermostat') {
              const sp = Number(d.attributes?.setpoint ?? d.status);
              if (!isNaN(sp)) m.set(d.id, sp);
            }
          }
          return m;
        });
        setDimmerLevels(prev => {
          const m = new Map(prev);
          for (const d of fresh) {
            if (['dimmer', 'rgb', 'led'].includes(d.type)) {
              const lv = Number(d.attributes?.brightness ?? (d.status !== 'on' && d.status !== 'off' ? d.status : 50));
              if (!isNaN(lv)) m.set(d.id, Math.min(100, Math.max(0, lv)));
            }
          }
          return m;
        });
      }).catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useEffect(() => { setFavorites(loadFavs()); }, []);

  // Gerätezustand-Updates von anderen Komponenten empfangen (lokale Events bei Klick)
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);
    return () => window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
  }, []);

  // Echtzeit-Updates via Laravel Reverb WebSocket (MQTT → Backend → Browser)
  useEffect(() => {
    const deviceIds = new Set(initialDevices.map(d => d.id));
    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('devices').listen('.device.updated', (data: {
        id: number; status: string; attributes: Record<string, unknown>; last_seen: string;
      }) => {
        if (!deviceIds.has(data.id)) return; // nur Geräte dieses Raums
        setDevices(prev => prev.map(d => d.id === data.id
          ? { ...d, status: data.status, attributes: data.attributes, last_seen: data.last_seen }
          : d
        ));
        // Thermostat-Sollwert synchronisieren
        if (data.attributes?.setpoint !== undefined) {
          setSetpoints(m => new Map(m).set(data.id, Number(data.attributes.setpoint)));
        }
      });
    } catch (err) {
      console.warn('[WebSocket] Reverb nicht erreichbar', err);
    }
    return () => {
      if (echo) echo.leaveChannel('devices');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

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

  const handleCoverCmd = async (device: Device, cmd: 'open' | 'close' | 'stop') => {
    if (pending.has(device.id)) return;
    const optimisticStatus = cmd === 'open' ? 'on' : cmd === 'close' ? 'off' : device.status;
    setPending(p => new Set(p).add(device.id));
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: optimisticStatus } : d));
    try {
      await api.setDeviceStatus(device.id, cmd);
      emitDeviceUpdate(device.id, optimisticStatus);
    } catch {
      setDevices(prev => prev.map(d => d.id === device.id ? device : d));
    } finally {
      setPending(p => { const n = new Set(p); n.delete(device.id); return n; });
    }
  };

  const handleSetpointChange = async (device: Device, delta: number) => {
    const current = setpoints.get(device.id) ?? 20;
    const next = Math.round((current + delta) * 2) / 2; // 0.5°C Schritte
    const clamped = Math.min(30, Math.max(5, next));
    setSetpoints(m => new Map(m).set(device.id, clamped));
    try {
      await api.setDeviceStatus(device.id, String(clamped));
    } catch {
      setSetpoints(m => new Map(m).set(device.id, current));
    }
  };

  const handleDimmerChange = async (device: Device, level: number) => {
    const clamped = Math.min(100, Math.max(0, level));
    setDimmerLevels(m => new Map(m).set(device.id, clamped));
    const newStatus = clamped === 0 ? 'off' : 'on';
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: newStatus } : d));
    try {
      await api.setDeviceStatus(device.id, String(clamped));
      emitDeviceUpdate(device.id, newStatus);
    } catch {
      setDimmerLevels(m => new Map(m).set(device.id, level));
    }
  };

  const handleFanSpeedSet = async (device: Device, speed: string) => {
    if (pending.has(device.id)) return;
    setPending(p => new Set(p).add(device.id));
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: speed } : d));
    try {
      await api.setDeviceStatus(device.id, speed);
      emitDeviceUpdate(device.id, speed);
    } catch {
      setDevices(prev => prev.map(d => d.id === device.id ? device : d));
    } finally {
      setPending(p => { const n = new Set(p); n.delete(device.id); return n; });
    }
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

  const activeCount    = devices.filter((d) => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
  const toggleableCount = devices.filter((d) => isToggleable(d.type as DeviceType)).length;

  const turnRoomOff = async () => {
    if (turningOff) return;
    const active = devices.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType));
    if (active.length === 0) return;
    setTurningOff(true);
    await Promise.allSettled(
      active.map(d =>
        api.setDeviceStatus(d.id, 'off')
          .then(() => { setDevices(prev => prev.map(x => x.id === d.id ? { ...x, status: 'off' } : x)); emitDeviceUpdate(d.id, 'off'); })
          .catch(() => {})
      )
    );
    setTurningOff(false);
  };

  return (
    <div className="space-y-5 animate-page-in">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Zurück */}
        <button
          onClick={() => router.back()}
          className="cursor-pointer h-14 w-14 rounded-full flex items-center justify-center bg-muted hover:bg-accent transition-colors shrink-0 active:scale-90"
          aria-label="Zurück"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>

        {/* Raum-Icon */}
        <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center text-3xl select-none shrink-0">
          {room.icon ?? '🏠'}
        </div>

        {/* Name + Status */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold leading-tight truncate">{room.name}</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} von ${toggleableCount} aktiv`
              : `${devices.length} Gerät${devices.length !== 1 ? 'e' : ''}`}
          </p>
        </div>

        {/* Alles aus */}
        <button
          onClick={turnRoomOff}
          disabled={activeCount === 0 || turningOff}
          className={cn(
            'cursor-pointer h-14 w-14 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90',
            activeCount > 0
              ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
              : 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
          )}
          aria-label="Alles ausschalten"
        >
          {turningOff
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <PowerOff className="h-5 w-5" />}
        </button>
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
      {(() => {
        const controlDevices = devices.filter(d => !isSensor(d.type as DeviceType));
        const sensorDevices  = devices.filter(d => isSensor(d.type as DeviceType));

        const renderTile = (device: Device) => {
          const Icon       = deviceIcons[device.type as DeviceType] ?? deviceIcons.other;
          const typeColor  = getDeviceColors(device);
          const emoji      = getDeviceEmoji(device);
          const toggleable = isToggleable(device.type as DeviceType);
          const sensor     = isSensor(device.type as DeviceType);
          const isCover    = device.type === 'cover';
          const isButton   = device.type === 'button';
          const isTherm    = device.type === 'thermostat';
          const isDimmer   = device.type === 'dimmer';
          const isRgb      = device.type === 'rgb';
          const isLed      = device.type === 'led';
          const isFan      = device.type === 'fan';
          const isValve    = device.type === 'valve';
          const ble        = isBleDevice(device);
          const useBridge  = ble && hasMac(device);
          const useBleWeb  = ble && !useBridge;
          const bleState   = getBleState(device.id);
          const isOn       = device.status === 'on';
          const isActive   = isOn
            || (isFan   && ['low', 'medium', 'high'].includes(device.status))
            || (isTherm && !['off', 'unknown', ''].includes(device.status));
          const isPending  = pending.has(device.id);
          const isDisabled = isPending;

          const isMqttShelly = ['shelly_gen3', 'shelly_gen1', 'shelly_gen3_http'].includes(
            (device.attributes?.protocol as string) ?? ''
          );
          const powerW = typeof device.attributes?.power_w === 'number' ? device.attributes.power_w as number : null;

          // Ganzes Tile = Tap für einfache An/Aus-Geräte
          const isTileTap = !sensor && ['light', 'plug', 'switch', 'valve', 'fan'].includes(device.type);

          // Statustext unter dem Gerätenamen
          const statusLabel: string | null = sensor ? null
            : isFan ? (device.status === 'low' ? 'Niedrig' : device.status === 'medium' ? 'Mittel' : device.status === 'high' ? 'Hoch' : isOn ? 'An' : 'Aus')
            : isTherm ? (isActive ? 'Aktiv' : 'Aus')
            : (isDimmer || isRgb || isLed || isCover) ? null
            : isOn ? 'An' : 'Aus';

          return (
            <div
              key={device.id}
              onClick={isTileTap && !isDisabled ? () => handleToggle(device) : undefined}
              className={cn(
                'relative rounded-2xl border p-5 transition-all duration-300 ease-in-out min-h-[130px] flex flex-col',
                isTileTap && !isDisabled && 'cursor-pointer select-none active:scale-[0.97]',
                isActive && !sensor
                  ? getActiveTileClasses(device)
                  : 'bg-card border-border',
                isPending && 'opacity-60',
              )}
            >
              {/* ── Icon + Name + Power-Button + Favoriten-Stern ── */}
              <div className="flex items-start gap-3">
                <div className={cn(
                  'h-12 w-12 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 ease-in-out',
                  isActive && !sensor
                    ? cn(typeColor.bg.replace('/10', '/20'), typeColor.text, 'scale-110')
                    : 'bg-muted text-muted-foreground scale-100'
                )}>
                  {emoji
                    ? <span className="text-2xl leading-none">{emoji}</span>
                    : <Icon className="h-6 w-6" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-tight truncate">{device.name}</p>
                  {statusLabel !== null && (
                    <p className={cn(
                      'text-sm mt-0.5 font-medium transition-colors duration-300',
                      isActive ? typeColor.text : 'text-muted-foreground'
                    )}>
                      {statusLabel}
                      {powerW !== null && powerW > 0 && (
                        <span className="ml-1.5 text-xs font-normal opacity-80">{powerW.toFixed(1)} W</span>
                      )}
                    </p>
                  )}
                  {statusLabel === null && powerW !== null && powerW > 0 && (
                    <p className="text-sm mt-0.5 text-muted-foreground">{powerW.toFixed(1)} W</p>
                  )}
                </div>

                {/* Power-Button für alle schaltbaren Nicht-Sensor-Geräte + Thermostat */}
                {(toggleable || isTherm) && !sensor && !isCover && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (isTherm) {
                        // Thermostat: 'auto' ↔ 'off'
                        const newStatus = isActive ? 'off' : 'auto';
                        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: newStatus } : d));
                        api.setDeviceStatus(device.id, newStatus)
                          .catch(() => setDevices(prev => prev.map(d => d.id === device.id ? device : d)));
                      } else {
                        handleToggle(device);
                      }
                    }}
                    disabled={isDisabled}
                    aria-label={isActive ? 'Ausschalten' : 'Einschalten'}
                    className={cn(
                      'h-12 w-12 rounded-full flex items-center justify-center shrink-0 transition-all duration-300',
                      'focus:outline-none active:scale-90',
                      isActive
                        ? cn(typeColor.bg.replace('/10', '/20'), typeColor.text)
                        : 'bg-muted text-muted-foreground',
                      isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                      isPending && 'animate-pulse'
                    )}
                  >
                    <Power className="h-5 w-5" />
                  </button>
                )}

                {/* Favoriten-Stern */}
                <button
                  onClick={e => { e.stopPropagation(); toggleFav(device.id); }}
                  className="cursor-pointer h-9 w-9 flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                  aria-label="Favorit"
                >
                  <Star className={cn('h-4 w-4', favorites.includes(device.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30')} />
                </button>
              </div>

              {/* ── Controls (event isolation, flex-1) ──────────────── */}
              <div className="flex-1" onClick={e => e.stopPropagation()}>

                {/* Sensor-Wert + Verlaufsgraph */}
                {sensor && (() => {
                  const LABELS: Partial<Record<string, [string, string]>> = {
                    sensor_door:      ['Offen',          'Geschlossen'],
                    sensor_motion:    ['Bewegt',         'Ruhig'],
                    sensor_flood:     ['💧 Wasser!',     'Trocken'],
                    sensor_vibration: ['Erschütterung',  'Ruhig'],
                    sensor_smoke:     ['🔥 Alarm',       '✓ OK'],
                  };
                  const isBinary = device.type in LABELS;
                  const active   = device.status === 'on' || device.status === 'true';
                  const [activeLabel, inactiveLabel] = LABELS[device.type] ?? ['Aktiv', 'Ruhig'];
                  return (
                    <>
                      {isBinary ? (
                        <p className={cn('mt-3 text-xl font-bold', active ? 'text-amber-500' : 'text-muted-foreground')}>
                          {active ? activeLabel : inactiveLabel}
                        </p>
                      ) : (
                        <p className="mt-3 text-2xl font-bold tabular-nums">
                          {device.status !== 'unknown' ? device.status : '–'}
                          <span className="text-sm font-medium text-muted-foreground ml-0.5">
                            {device.type === 'sensor_temperature' && '°C'}
                            {device.type === 'sensor_humidity' && '%'}
                            {device.type === 'energy_meter' && 'W'}
                            {device.type === 'sensor_lux' && 'lx'}
                          </span>
                        </p>
                      )}
                      {(device.type === 'sensor_temperature' || device.type === 'sensor_humidity') && (
                        <SensorChart deviceId={device.id} deviceType={device.type as DeviceType} currentValue={device.status} />
                      )}
                    </>
                  );
                })()}

                {/* Ventil-Status */}
                {isValve && (
                  <p className={cn('mt-3 text-base font-semibold', isActive ? 'text-teal-500' : 'text-muted-foreground')}>
                    {isActive ? 'Offen' : 'Geschlossen'}
                  </p>
                )}

                {/* BLE */}
                {useBleWeb && (
                  <div className="mt-3">
                    {bleState === 'connected' ? (
                      <div className="flex items-center gap-1.5">
                        <span className="flex items-center gap-1 text-xs text-blue-500 font-medium py-1 px-2 rounded-full bg-blue-500/10">
                          <BluetoothConnected className="h-3 w-3 shrink-0" />
                          {shellyBle.getPairedName(device.id) ?? 'Verbunden'}
                        </span>
                        <button onClick={() => handleBleForget(device)}
                          className="cursor-pointer text-xs text-muted-foreground hover:text-destructive transition-colors px-1">✕</button>
                      </div>
                    ) : bleState === 'connecting' ? (
                      <span className="w-fit flex items-center gap-1 text-xs text-muted-foreground py-1 px-2 rounded-full bg-muted">
                        <Bluetooth className="h-3 w-3 shrink-0 animate-pulse" /> Verbinde…
                      </span>
                    ) : (
                      <button onClick={() => handleBlePair(device)}
                        className={cn('cursor-pointer w-fit flex items-center gap-1 text-xs font-medium py-1 px-2 rounded-full transition-colors',
                          bleState === 'error' ? 'text-destructive bg-destructive/10 hover:bg-destructive/20'
                          : shellyBle.getPairedName(device.id) ? 'text-blue-500 bg-blue-500/10 hover:bg-blue-500/20'
                          : 'text-muted-foreground bg-muted hover:bg-accent'
                        )}>
                        {bleState === 'error' ? <BluetoothOff className="h-3 w-3 shrink-0" /> : <Bluetooth className="h-3 w-3 shrink-0" />}
                        {bleState === 'error' ? 'Erneut verbinden' : shellyBle.getPairedName(device.id) ? 'Neu verbinden' : 'Koppeln'}
                      </button>
                    )}
                  </div>
                )}

                {useBridge && (
                  <div className="mt-3">
                    <span className="w-fit flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium py-1 px-2 rounded-full bg-emerald-500/10">
                      <Bluetooth className="h-3 w-3 shrink-0" /> BLE Bridge
                    </span>
                  </div>
                )}

                {useBridge && toggleable && !sensor && <ShellyPlugPanel deviceId={device.id} mode="ble" />}
                {isMqttShelly && toggleable && !sensor && <ShellyPlugPanel deviceId={device.id} mode="http" />}

                {/* DeviceHistory und last_seen kommen in die Bottom-Section */}

                {/* Rollladen */}
                {isCover && (
                  <>
                    <div className="mt-4 flex gap-2">
                      <button onClick={() => handleCoverCmd(device, 'open')} disabled={isDisabled}
                        className={cn('cursor-pointer flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-xl text-sm font-medium transition-colors',
                          isOn ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-muted hover:bg-accent',
                          isDisabled && 'opacity-40 cursor-not-allowed')}>
                        <ChevronUp className="h-5 w-5" /> Öffnen
                      </button>
                      <button onClick={() => handleCoverCmd(device, 'stop')} disabled={isDisabled}
                        className={cn('cursor-pointer flex items-center justify-center p-3.5 rounded-xl bg-muted hover:bg-accent transition-colors',
                          isDisabled && 'opacity-40 cursor-not-allowed')} aria-label="Stop">
                        <Square className="h-5 w-5" />
                      </button>
                      <button onClick={() => handleCoverCmd(device, 'close')} disabled={isDisabled}
                        className={cn('cursor-pointer flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-xl text-sm font-medium transition-colors bg-muted hover:bg-accent',
                          isDisabled && 'opacity-40 cursor-not-allowed')}>
                        <ChevronDown className="h-4 w-4" /> Schließen
                      </button>
                    </div>
                    {device.status && !['on','off','open','close','stop','unknown'].includes(device.status) && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Position: <span className="font-semibold text-foreground">{device.status}%</span>
                      </p>
                    )}
                  </>
                )}

                {/* Thermostat: nur Solltemperatur, An/Aus über Header-Button */}
                {isTherm && (
                  <div className="mt-4 space-y-3">
                    {device.status && !['on','off','auto','unknown'].includes(device.status) && (
                      <p className="text-sm text-muted-foreground">
                        Aktuell: <span className="font-semibold text-foreground">{device.status}°C</span>
                      </p>
                    )}
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Solltemperatur</p>
                      <div className="flex items-center gap-3">
                        <button onClick={() => handleSetpointChange(device, -0.5)}
                          className="cursor-pointer h-12 w-12 rounded-xl bg-muted hover:bg-accent flex items-center justify-center transition-colors shrink-0" aria-label="-0.5°C">
                          <Minus className="h-5 w-5" />
                        </button>
                        <div className="flex-1 text-center">
                          <span className="text-2xl font-bold tabular-nums">{(setpoints.get(device.id) ?? 20).toFixed(1)}</span>
                          <span className="text-sm text-muted-foreground ml-0.5">°C</span>
                        </div>
                        <button onClick={() => handleSetpointChange(device, +0.5)}
                          className="cursor-pointer h-12 w-12 rounded-xl bg-muted hover:bg-accent flex items-center justify-center transition-colors shrink-0" aria-label="+0.5°C">
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Dimmer / LED / RGB */}
                {(isDimmer || isRgb || isLed) && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Helligkeit</p>
                      <span className="text-sm font-semibold tabular-nums">{dimmerLevels.get(device.id) ?? 50}%</span>
                    </div>
                    <input type="range" min={0} max={100} step={5}
                      value={dimmerLevels.get(device.id) ?? 50}
                      onChange={e => setDimmerLevels(m => new Map(m).set(device.id, Number(e.target.value)))}
                      onPointerUp={e => handleDimmerChange(device, Number((e.target as HTMLInputElement).value))}
                      className="w-full range-slider"
                      style={{ '--val': `${dimmerLevels.get(device.id) ?? 50}%` } as React.CSSProperties}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0%</span><span>50%</span><span>100%</span>
                    </div>
                  </div>
                )}
                {isRgb && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    🎨 Farbe via MQTT-Attribut <code className="text-[10px] bg-muted px-1 py-0.5 rounded">color</code>
                  </p>
                )}

                {/* Lüfter */}
                {isFan && (
                  <div className="mt-4">
                    <p className="text-sm text-muted-foreground mb-2">Lüfterstufe</p>
                    <div className="flex gap-1.5">
                      {([['Niedrig','low'],['Mittel','medium'],['Hoch','high']] as const).map(([lbl, val]) => (
                        <button key={val} onClick={() => handleFanSpeedSet(device, val)} disabled={isDisabled}
                          className={cn('cursor-pointer flex-1 py-3 rounded-xl text-sm font-medium transition-colors',
                            device.status === val ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 font-semibold' : 'bg-muted hover:bg-accent text-muted-foreground',
                            isDisabled && 'opacity-40 cursor-not-allowed')}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isButton && <p className="mt-3 text-sm text-muted-foreground">Eingang – kein Ausgang</p>}

              </div>{/* end controls */}

              {/* ── Bottom: History + Timestamp (immer unten) ──── */}
              {(toggleable && !sensor && !isCover || !!device.last_seen) && (
                <div className="mt-auto pt-2" onClick={e => e.stopPropagation()}>
                  {toggleable && !sensor && !isCover && (
                    <DeviceHistory deviceId={device.id} deviceName={device.name} />
                  )}
                  {device.last_seen && (
                    <p className="text-xs text-muted-foreground/50 mt-1 select-none">
                      {formatLastSeen(device.last_seen)}
                    </p>
                  )}
                </div>
              )}

            </div>
          );
        };

        return (
          <div className="space-y-5">
            {/* Steuergeräte */}
            {controlDevices.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {controlDevices.map(renderTile)}
              </div>
            )}

            {/* Sensoren — eigene Sektion darunter */}
            {sensorDevices.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-3">Sensoren</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {sensorDevices.map(renderTile)}
                </div>
              </div>
            )}

            {devices.length === 0 && (
              <p className="text-muted-foreground text-sm py-10 text-center">
                Keine Geräte in diesem Raum.
              </p>
            )}
          </div>
        );
      })()}

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


