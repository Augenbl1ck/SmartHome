'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Device, Room } from '@/lib/api';
import { shellyBle, BleState } from '@/lib/bluetooth';
import { deviceIcons, isSensor, isToggleable, isComputer, countsAsActive, getDeviceColors, getDeviceEmoji, commandBlocked, nextCommandBlocked, numericAttr } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { ArrowLeft, Bluetooth, BluetoothConnected, BluetoothOff, Star, ChevronUp, ChevronDown, Square, Minus, Plus, PowerOff, Loader2, Power, Lock, Unlock, Wind, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeviceHistory from '@/components/DeviceHistory';
import SensorDayStats from '@/components/SensorDayStats';
import ShellyPlugPanel from '@/components/ShellyPlugPanel';
import ZigbeePlugPanel from '@/components/ZigbeePlugPanel';
import ThermostatAdvancedPanel from '@/components/ThermostatAdvancedPanel';
import { loadFavoritesLocal, saveFavorites, syncFavoritesFromServer } from '@/lib/favorites';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { getEcho } from '@/lib/echo';
import { useSmartHomeStore } from '@/store/smarthome';
import BleScanDialog from '@/components/BleScanDialog';
import {
  encodeCapStatus,
  isChildLockOn,
  isOpenWindowOn,
  getCalibration,
  getFrostProtection,
  getRunningStateLabel,
} from '@/lib/thermostat-capabilities';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

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
    case 'computer':
      return 'bg-sky-500/15 border-sky-400/40 shadow-sm';
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
  roomId: number;
  room: Room | null;
  initialDevices: Device[];
}

function isBleDevice(device: Device): boolean {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

/** Hat das Gerät eine MAC-Adresse? → BLE Bridge auf dem Server, kein Browser-BLE nötig */
function hasMac(device: Device): boolean {
  return !!(device.attributes?.ble_address as string | undefined)?.trim();
}

function loadFavs(): number[] {
  return loadFavoritesLocal();
}
function saveFavs(ids: number[]) {
  void saveFavorites(ids);
}

export default function RoomClient({ roomId, room: roomProp, initialDevices }: Props) {
  const router = useRouter();
  const storeRoom = useSmartHomeStore(s => s.rooms.find(r => r.id === roomId) ?? null);
  const storeDevices = useSmartHomeStore(s => s.devices);
  const room = roomProp ?? storeRoom;
  const seedDevices = initialDevices.length > 0
    ? initialDevices
    : storeDevices.filter(d => d.room_id === roomId);
  const [devices, setDevices]     = useState(seedDevices);
  const [pending, setPending]     = useState<Set<number>>(new Set());
  const [bleStates, setBleStates] = useState<Map<number, BleState>>(new Map());
  const [bleError, setBleError]   = useState<string | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [scanDevice, setScanDevice] = useState<Device | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [wakeHint, setWakeHint] = useState<number | null>(null);
  const [thermoConfigOpen, setThermoConfigOpen] = useState<Set<number>>(new Set());
  const [editingSetpointId, setEditingSetpointId] = useState<number | null>(null);
  const [setpointDraft, setSetpointDraft] = useState('');
  const [roomWaited, setRoomWaited] = useState(false);

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

  const replaceRoomDevices = useSmartHomeStore(s => s.replaceRoomDevices);
  const upsertDevice = useSmartHomeStore(s => s.upsertDevice);

  const applyDeviceList = (fresh: Device[]) => {
    setDevices(fresh);
    replaceRoomDevices(roomId, fresh);
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
  };

  const refreshDevices = () => {
    api.getDevices(roomId).then(applyDeviceList).catch(() => {});
  };

  // Beim Betreten des Raums + Tab-Focus neu laden (nicht nur Focus)
  useEffect(() => {
    const fromStore = useSmartHomeStore.getState().devices.filter(d => d.room_id === roomId);
    if (fromStore.length) applyDeviceList(fromStore);
    refreshDevices();
    window.addEventListener('focus', refreshDevices);
    return () => window.removeEventListener('focus', refreshDevices);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    if (room) return;
    const t = window.setTimeout(() => setRoomWaited(true), 2500);
    return () => window.clearTimeout(t);
  }, [room]);

  useEffect(() => {
    setFavorites(loadFavs());
    void syncFavoritesFromServer().then(setFavorites);
  }, []);

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
    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('devices').listen('.device.updated', (data: {
        id: number; room_id?: number; status: string; attributes: Record<string, unknown>; last_seen: string;
      }) => {
        if (data.room_id != null && data.room_id !== roomId) return;
        setDevices(prev => {
          const exists = prev.some(d => d.id === data.id);
          if (!exists) {
            refreshDevices();
            return prev;
          }
          return prev.map(d => d.id === data.id
            ? { ...d, status: data.status, attributes: data.attributes, last_seen: data.last_seen }
            : d
          );
        });
        const existing = useSmartHomeStore.getState().devices.find(d => d.id === data.id);
        if (existing) {
          upsertDevice({
            ...existing,
            status: data.status,
            attributes: data.attributes,
            last_seen: data.last_seen,
          });
        }
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
  }, [roomId]);

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
    const blocked = commandBlocked(device, cmd);
    if (blocked) {
      toast.warning(blocked.startsWith('Gesperrt') ? blocked : `Gesperrt: ${blocked}`);
      return;
    }
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

  const applySetpoint = async (device: Device, value: number) => {
    const current = setpoints.get(device.id) ?? 20;
    const clamped = Math.min(35, Math.max(4, Math.round(value * 2) / 2)); // TRVZB: 4–35°C, 0.5°C
    if (clamped === current) return;
    setSetpoints(m => new Map(m).set(device.id, clamped));
    try {
      const updated = await api.setDeviceStatus(device.id, String(clamped));
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updated } : d));
    } catch {
      setSetpoints(m => new Map(m).set(device.id, current));
    }
  };

  const handleSetpointChange = async (device: Device, delta: number) => {
    const current = setpoints.get(device.id) ?? 20;
    await applySetpoint(device, current + delta);
  };

  const commitSetpointDraft = async (device: Device) => {
    const raw = Number(setpointDraft.replace(',', '.'));
    setEditingSetpointId(null);
    if (!Number.isFinite(raw)) return;
    await applySetpoint(device, raw);
  };

  const handleThermostatCap = async (device: Device, status: string, optimisticAttrs: Record<string, unknown>) => {
    if (pending.has(device.id)) return;
    setPending(p => new Set(p).add(device.id));
    setDevices(prev => prev.map(d =>
      d.id === device.id
        ? { ...d, attributes: { ...(d.attributes ?? {}), ...optimisticAttrs } }
        : d
    ));
    try {
      const updated = await api.setDeviceStatus(device.id, status);
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updated } : d));
    } catch {
      setDevices(prev => prev.map(d => d.id === device.id ? device : d));
    } finally {
      setPending(p => { const n = new Set(p); n.delete(device.id); return n; });
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
      const prev = Number(device.attributes?.brightness ?? (device.status !== 'on' && device.status !== 'off' ? device.status : 50));
      setDimmerLevels(m => new Map(m).set(device.id, Number.isFinite(prev) ? prev : 50));
      setDevices(old => old.map(d => d.id === device.id ? device : d));
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

  const handleWake = async (device: Device) => {
    if (pending.has(device.id) || device.status === 'on') return;
    const blocked = commandBlocked(device, 'on');
    if (blocked) {
      toast.warning(blocked.startsWith('Gesperrt') ? blocked : `Gesperrt: ${blocked}`);
      return;
    }
    setPending((p) => new Set(p).add(device.id));
    try {
      await api.setDeviceStatus(device.id, 'on');
      setWakeHint(device.id);
      window.setTimeout(() => setWakeHint(id => (id === device.id ? null : id)), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBleError(msg);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(device.id); return n; });
    }
  };

  const handleToggle = async (device: Device) => {
    if (isComputer(device.type as DeviceType)) {
      await handleWake(device);
      return;
    }
    if (pending.has(device.id)) return;
    const blocked = nextCommandBlocked(device);
    if (blocked) {
      toast.warning(blocked.startsWith('Gesperrt') ? blocked : `Gesperrt: ${blocked}`);
      return;
    }
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

  const activeCount     = devices.filter((d) => d.status === 'on' && countsAsActive(d.type as DeviceType)).length;
  const listedCount     = devices.filter((d) => countsAsActive(d.type as DeviceType)).length;
  const switchableOn    = devices.filter((d) => d.status === 'on' && isToggleable(d.type as DeviceType)).length;

  const turnRoomOff = async () => {
    if (turningOff) return;
    const active = devices.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType));
    const free = active.filter(d => !commandBlocked(d, 'off'));
    const skipped = active.length - free.length;
    if (free.length === 0) {
      if (skipped > 0) toast.warning('Geräte durch Sperre geschützt — nichts ausgeschaltet.');
      return;
    }
    setTurningOff(true);
    await Promise.allSettled(
      free.map(d =>
        api.setDeviceStatus(d.id, 'off')
          .then(() => { setDevices(prev => prev.map(x => x.id === d.id ? { ...x, status: 'off' } : x)); emitDeviceUpdate(d.id, 'off'); })
          .catch(() => {})
      )
    );
    setTurningOff(false);
    if (skipped > 0) toast.warning(`${skipped} Gerät${skipped === 1 ? '' : 'e'} wegen Sperre nicht ausgeschaltet.`);
  };

  if (!room) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {roomWaited ? 'Raum nicht gefunden.' : 'Raum wird geladen…'}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-page-in">

      {/* ── Header (sticky: bleibt unter der App-Nav klickbar) ─────── */}
      <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-1 flex items-center gap-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {/* Zurück */}
        <button
          type="button"
          onClick={() => router.push('/')}
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
              ? `${activeCount} von ${listedCount} aktiv`
              : `${devices.length} Gerät${devices.length !== 1 ? 'e' : ''}`}
          </p>
        </div>

        {/* Alles aus */}
        <button
          onClick={turnRoomOff}
          disabled={switchableOn === 0 || turningOff}
          className={cn(
            'cursor-pointer h-14 w-14 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90',
            switchableOn > 0
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
          const isComputerDev = isComputer(device.type as DeviceType);
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
            // Thermostat: nur echte Heiz-Modi — nicht jede Zahl/Setpoint als "An"
            || (isTherm && ['auto', 'heat', 'on'].includes(device.status));
          const isPending  = pending.has(device.id);
          const lockReason = nextCommandBlocked(device);
          const isDisabled = isPending || (!isComputerDev && !!lockReason);

          const isMqttShelly = ['shelly_gen3', 'shelly_gen1', 'shelly_gen3_http'].includes(
            (device.attributes?.protocol as string) ?? ''
          );
          const isZigbeePlug = device.attributes?.protocol === 'zigbee2mqtt' && device.type === 'plug';
          const powerW = typeof device.attributes?.power_w === 'number' ? device.attributes.power_w as number : null;

          // Ganzes Tile = Tap für einfache An/Aus-Geräte; Computer nur zum Starten wenn aus
          const isTileTap = !sensor && (
            ['light', 'plug', 'switch', 'valve', 'fan'].includes(device.type)
            || (isComputerDev && !isOn)
          );

          // Statustext unter dem Gerätenamen
          const statusLabel: string | null = sensor ? null
            : isFan ? (device.status === 'low' ? 'Niedrig' : device.status === 'medium' ? 'Mittel' : device.status === 'high' ? 'Hoch' : isOn ? 'An' : 'Aus')
            : isTherm ? (isActive ? 'Aktiv' : 'Aus')
            : (isDimmer || isRgb || isLed || isCover) ? null
            : isComputerDev && wakeHint === device.id ? 'Startsignal gesendet'
            : isComputerDev && !((typeof device.attributes?.ip === 'string' && device.attributes.ip) || device.mqtt_topic) ? 'Keine IP'
            : lockReason ? lockReason
            : isOn ? 'An' : 'Aus';

          return (
            <div
              key={device.id}
              onClick={isTileTap && !isDisabled ? () => handleToggle(device) : undefined}
              className={cn(
                'relative rounded-2xl border p-5 transition-all duration-300 ease-in-out min-h-32.5 flex flex-col',
                isTileTap && !isDisabled && 'cursor-pointer select-none active:scale-[0.97] [&:active:has(button:active,input:active)]:scale-100',
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

                {/* Power-Button: Computer nur zum Starten, wenn aus — kein Ausschalten */}
                {(isComputerDev ? !isOn : (toggleable || isTherm)) && !sensor && !isCover && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (isTherm) {
                        const newStatus = isActive ? 'off' : 'heat';
                        const blocked = commandBlocked(device, newStatus);
                        if (blocked) {
                          toast.warning(blocked.startsWith('Gesperrt') ? blocked : `Gesperrt: ${blocked}`);
                          return;
                        }
                        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: newStatus } : d));
                        api.setDeviceStatus(device.id, newStatus)
                          .then(updated => setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updated } : d)))
                          .catch(() => setDevices(prev => prev.map(d => d.id === device.id ? device : d)));
                      } else if (isComputerDev) {
                        handleWake(device);
                      } else {
                        handleToggle(device);
                      }
                    }}
                    disabled={isDisabled}
                    aria-label={isComputerDev ? 'Starten' : isActive ? 'Ausschalten' : 'Einschalten'}
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

                {/* Sensor-Wert + Min/Max heute */}
                {sensor && (() => {
                  const LABELS: Partial<Record<string, [string, string]>> = {
                    sensor_door:      ['Offen',          'Geschlossen'],
                    sensor_motion:    ['Bewegt',         'Ruhig'],
                    sensor_flood:     ['💧 Wasser!',     'Trocken'],
                    sensor_vibration: ['Erschütterung',  'Ruhig'],
                    sensor_smoke:     ['🔥 Alarm',       '✓ OK'],
                  };
                  const isBinary = device.type in LABELS;
                  const active   = device.type === 'sensor_door'
                    ? device.status === 'open'
                    : device.status === 'on' || device.status === 'true' || device.status === 'open';
                  const [activeLabel, inactiveLabel] = LABELS[device.type] ?? ['Aktiv', 'Ruhig'];
                  const isClimate = device.type === 'sensor_temperature' || device.type === 'sensor_humidity';
                  const temp = isClimate
                    ? (numericAttr(device.attributes, 'temperature', 'local_temperature')
                      ?? (Number.isFinite(Number(device.status)) ? Number(device.status) : null))
                    : null;
                  const humidity = isClimate ? numericAttr(device.attributes, 'humidity') : null;
                  const battery = numericAttr(device.attributes, 'battery');
                  return (
                    <>
                      {isBinary ? (
                        <p className={cn('mt-3 text-xl font-bold', active ? 'text-amber-500' : 'text-muted-foreground')}>
                          {active ? activeLabel : inactiveLabel}
                        </p>
                      ) : isClimate ? (
                        <div className="mt-3 space-y-1">
                          {temp != null && (
                            <p className="text-2xl font-bold tabular-nums">
                              {temp.toFixed(1)}
                              <span className="text-sm font-medium text-muted-foreground ml-0.5">°C</span>
                            </p>
                          )}
                          {humidity != null && (
                            <p className={cn('tabular-nums', temp != null ? 'text-base font-semibold text-muted-foreground' : 'text-2xl font-bold')}>
                              {humidity.toFixed(0)}
                              <span className="text-sm font-medium text-muted-foreground ml-0.5">%</span>
                              {temp != null ? <span className="text-xs font-normal ml-1">Luftfeuchte</span> : null}
                            </p>
                          )}
                          {temp == null && humidity == null && (
                            <p className="text-2xl font-bold tabular-nums">
                              {device.status !== 'unknown' ? device.status : '–'}
                            </p>
                          )}
                          {battery != null && (
                            <p className="text-xs text-muted-foreground">Batterie {battery}%</p>
                          )}
                          {temp != null && <SensorDayStats device={device} />}
                        </div>
                      ) : (
                        <p className="mt-3 text-2xl font-bold tabular-nums">
                          {device.status !== 'unknown' ? device.status : '–'}
                          <span className="text-sm font-medium text-muted-foreground ml-0.5">
                            {device.type === 'energy_meter' && 'W'}
                            {device.type === 'sensor_lux' && 'lx'}
                          </span>
                        </p>
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
                {isMqttShelly && toggleable && !sensor && (
                  <ShellyPlugPanel
                    deviceId={device.id}
                    mode="http"
                    mqttPowerW={typeof device.attributes?.power_w === 'number' ? device.attributes.power_w as number : Number(device.attributes?.power_w) || null}
                  />
                )}
                {isZigbeePlug && (
                  <ZigbeePlugPanel
                    device={device}
                    onUpdated={(updated) => setDevices(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d))}
                  />
                )}

                {/* DeviceHistory und last_seen kommen in die Bottom-Section */}

                {/* Rollladen */}
                {isCover && (
                  <>
                    <div className="mt-4 flex gap-2">
                      <button onClick={() => handleCoverCmd(device, 'open')} disabled={isPending || !!commandBlocked(device, 'open')}
                        className={cn('cursor-pointer flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-xl text-sm font-medium transition-colors',
                          isOn ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-muted hover:bg-accent',
                          (isPending || commandBlocked(device, 'open')) && 'opacity-40 cursor-not-allowed')}>
                        <ChevronUp className="h-5 w-5" /> Öffnen
                      </button>
                      <button onClick={() => handleCoverCmd(device, 'stop')} disabled={isPending}
                        className={cn('cursor-pointer flex items-center justify-center p-3.5 rounded-xl bg-muted hover:bg-accent transition-colors',
                          isPending && 'opacity-40 cursor-not-allowed')} aria-label="Stop">
                        <Square className="h-5 w-5" />
                      </button>
                      <button onClick={() => handleCoverCmd(device, 'close')} disabled={isPending || !!commandBlocked(device, 'close')}
                        className={cn('cursor-pointer flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-xl text-sm font-medium transition-colors bg-muted hover:bg-accent',
                          (isPending || commandBlocked(device, 'close')) && 'opacity-40 cursor-not-allowed')}>
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

                {/* Thermostat: Aktuell sichtbar, Rest unter „Gerät konfigurieren“ */}
                {isTherm && (
                  <div className="mt-4 space-y-2">
                    {(() => {
                      const current = numericAttr(device.attributes, 'local_temperature', 'temperature');
                      if (current == null) return null;
                      return (
                      <p className="text-sm text-muted-foreground">
                        Aktuell:{' '}
                        <span className="font-semibold text-foreground">
                          {current.toFixed(1)}°C
                        </span>
                        {getRunningStateLabel(device.attributes) && (
                          <span className="ml-2 text-xs">
                            ({getRunningStateLabel(device.attributes)})
                          </span>
                        )}
                      </p>
                      );
                    })()}

                    <button
                      type="button"
                      onClick={() => setThermoConfigOpen(prev => {
                        const next = new Set(prev);
                        if (next.has(device.id)) next.delete(device.id);
                        else next.add(device.id);
                        return next;
                      })}
                      className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Settings className="h-3 w-3" />
                      Gerät konfigurieren
                      {thermoConfigOpen.has(device.id)
                        ? <ChevronUp className="h-3 w-3" />
                        : <ChevronDown className="h-3 w-3" />}
                    </button>

                    {thermoConfigOpen.has(device.id) && (
                      <div className="space-y-3 pt-1">
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">Solltemperatur</p>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => handleSetpointChange(device, -0.5)}
                              className="cursor-pointer h-12 w-12 rounded-xl bg-muted hover:bg-accent flex items-center justify-center transition-colors shrink-0"
                              aria-label="-0.5°C"
                            >
                              <Minus className="h-5 w-5" />
                            </button>
                            <div className="flex-1 text-center">
                              {editingSetpointId === device.id ? (
                                <div className="inline-flex items-baseline justify-center gap-0.5">
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step={0.5}
                                    min={4}
                                    max={35}
                                    autoFocus
                                    value={setpointDraft}
                                    onChange={(e) => setSetpointDraft(e.target.value)}
                                    onBlur={() => { void commitSetpointDraft(device); }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void commitSetpointDraft(device);
                                      }
                                      if (e.key === 'Escape') setEditingSetpointId(null);
                                    }}
                                    className="w-20 text-center text-2xl font-bold tabular-nums rounded-md border border-input bg-background px-1 py-0.5"
                                    aria-label="Solltemperatur eingeben"
                                  />
                                  <span className="text-sm text-muted-foreground">°C</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSetpointId(device.id);
                                    setSetpointDraft((setpoints.get(device.id) ?? 20).toFixed(1));
                                  }}
                                  className="cursor-pointer inline-flex items-baseline justify-center rounded-lg px-2 py-1 hover:bg-muted/80 transition-colors"
                                  aria-label="Solltemperatur tippen"
                                >
                                  <span className="text-2xl font-bold tabular-nums">
                                    {(setpoints.get(device.id) ?? 20).toFixed(1)}
                                  </span>
                                  <span className="text-sm text-muted-foreground ml-0.5">°C</span>
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleSetpointChange(device, +0.5)}
                              className="cursor-pointer h-12 w-12 rounded-xl bg-muted hover:bg-accent flex items-center justify-center transition-colors shrink-0"
                              aria-label="+0.5°C"
                            >
                              <Plus className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              {isChildLockOn(device.attributes) ? (
                                <Lock className="h-4 w-4 text-orange-500 shrink-0" />
                              ) : (
                                <Unlock className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                              <span className="text-sm font-medium truncate">Kindersicherung</span>
                            </div>
                            <Switch
                              checked={isChildLockOn(device.attributes)}
                              disabled={isDisabled}
                              onCheckedChange={(on) =>
                                handleThermostatCap(
                                  device,
                                  encodeCapStatus('child_lock', on ? 'LOCK' : 'UNLOCK'),
                                  { child_lock: on ? 'LOCK' : 'UNLOCK' },
                                )
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <Wind className="h-4 w-4 text-sky-500 shrink-0" />
                              <span className="text-sm font-medium truncate">Offenes Fenster - Erkennung</span>
                            </div>
                            <Switch
                              checked={isOpenWindowOn(device.attributes)}
                              disabled={isDisabled}
                              onCheckedChange={(on) =>
                                handleThermostatCap(
                                  device,
                                  encodeCapStatus('open_window', on ? 'ON' : 'OFF'),
                                  { open_window: on ? 'ON' : 'OFF' },
                                )
                              }
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-muted/50 px-3 py-2.5 space-y-1">
                              <p className="text-xs text-muted-foreground">Kalibrierung (°C)</p>
                              <input
                                type="number"
                                step={0.2}
                                min={-12.7}
                                max={12.7}
                                disabled={isDisabled}
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
                                defaultValue={getCalibration(device.attributes)}
                                key={`cal-${device.id}-${getCalibration(device.attributes)}`}
                                onBlur={(e) => {
                                  const raw = Number(e.target.value);
                                  if (!Number.isFinite(raw)) return;
                                  const val = Math.round(Math.min(12.7, Math.max(-12.7, raw)) * 5) / 5;
                                  if (val === getCalibration(device.attributes)) return;
                                  handleThermostatCap(
                                    device,
                                    encodeCapStatus('local_temperature_calibration', String(val)),
                                    { local_temperature_calibration: val },
                                  );
                                }}
                              />
                            </div>
                            <div className="rounded-xl bg-muted/50 px-3 py-2.5 space-y-1">
                              <p className="text-xs text-muted-foreground">Frostschutz (°C)</p>
                              <input
                                type="number"
                                step={0.5}
                                min={4}
                                max={35}
                                disabled={isDisabled}
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
                                defaultValue={getFrostProtection(device.attributes)}
                                key={`frost-${device.id}-${getFrostProtection(device.attributes)}`}
                                onBlur={(e) => {
                                  const raw = Number(e.target.value);
                                  if (!Number.isFinite(raw)) return;
                                  const val = Math.round(Math.min(35, Math.max(4, raw)) * 2) / 2;
                                  if (val === getFrostProtection(device.attributes)) return;
                                  handleThermostatCap(
                                    device,
                                    encodeCapStatus('frost_protection_temperature', String(val)),
                                    { frost_protection_temperature: val },
                                  );
                                }}
                              />
                            </div>
                          </div>

                        <ThermostatAdvancedPanel
                          device={device}
                          disabled={isDisabled}
                          onUpdated={(updated) =>
                            setDevices((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)))
                          }
                        />
                        </div>
                      </div>
                    )}
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
                  {/* Verlauf auf Raumseite ausgeblendet */}
                  {/* {toggleable && !sensor && !isCover && (
                    <DeviceHistory deviceId={device.id} deviceName={device.name} />
                  )} */}
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


