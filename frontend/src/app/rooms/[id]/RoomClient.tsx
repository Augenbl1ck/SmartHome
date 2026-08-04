'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Device, Room } from '@/lib/api';
import { shellyBle, BleState } from '@/lib/bluetooth';
import { deviceIcons, deviceLabels, deviceColors, isSensor, isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { ArrowLeft, Bluetooth, BluetoothConnected, BluetoothOff, Power, Star, ChevronUp, ChevronDown, Square, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeviceHistory from '@/components/DeviceHistory';
import SensorChart from '@/components/SensorChart';
import ShellyPlugPanel from '@/components/ShellyPlugPanel';
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
  const [setpoints, setSetpoints] = useState<Map<number, number>>(new Map());
  const [dimmerLevels, setDimmerLevels] = useState<Map<number, number>>(new Map());

  // Beim Mount immer frische Gerätedaten laden (wichtig nach Navigation)
  useEffect(() => {
    api.getDevices(room.id).then(fresh => {
      setDevices(fresh);
      // Thermostat-Sollwerte und Dimmer-Level aus Geräte-Attributen initialisieren
      const spMap = new Map<number, number>();
      const dlMap = new Map<number, number>();
      for (const d of fresh) {
        if (d.type === 'thermostat') {
          const sp = Number(d.attributes?.setpoint ?? d.status);
          spMap.set(d.id, isNaN(sp) ? 20 : sp);
        }
        if (['dimmer', 'rgb', 'led'].includes(d.type)) {
          const lv = Number(d.attributes?.brightness ?? (d.status !== 'on' && d.status !== 'off' ? d.status : 50));
          dlMap.set(d.id, isNaN(lv) ? 50 : Math.min(100, Math.max(0, lv)));
        }
      }
      setSetpoints(spMap);
      setDimmerLevels(dlMap);
    }).catch(() => {});
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {devices.map((device) => {
          const Icon        = deviceIcons[device.type as DeviceType] ?? deviceIcons.other;
          const label       = deviceLabels[device.type as DeviceType] ?? 'Gerät';
          const typeColor   = deviceColors[device.type as DeviceType] ?? deviceColors.other;
          const toggleable  = isToggleable(device.type as DeviceType);
          const sensor      = isSensor(device.type as DeviceType);
          const isCover     = device.type === 'cover';
          const isButton    = device.type === 'button';
          const isTherm     = device.type === 'thermostat';
          const isDimmer    = device.type === 'dimmer';
          const isRgb       = device.type === 'rgb';
          const isLed       = device.type === 'led';
          const isFan       = device.type === 'fan';
          const isValve     = device.type === 'valve';
          const ble         = isBleDevice(device);
          const useBridge   = ble && hasMac(device);
          const useBleWeb   = ble && !useBridge;
          const bleState    = getBleState(device.id);
          const bleConn     = bleState === 'connected';
          const isOn        = device.status === 'on';
          const isActive    = isOn
            || (isFan   && ['low', 'medium', 'high'].includes(device.status))
            || (isTherm && !['off', 'unknown', ''].includes(device.status));
          const isPending   = pending.has(device.id);
          const isDisabled  = isPending;

          return (
            <div
              key={device.id}
              className={cn(
                'relative rounded-xl border p-4 transition-all min-h-[112px]',
                isActive && !sensor
                  ? 'border-green-500/25 bg-green-500/[0.04]'
                  : 'border-border bg-card',
                useBridge && toggleable && !sensor && 'pb-15'
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
                  isActive && !sensor
                    ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                    : cn(typeColor.bg, typeColor.text)
                )}>
                  <Icon style={{ width: 16, height: 16 }} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold leading-tight truncate">{device.name}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>

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
                      <p className={cn(
                        'mt-2 text-xl font-bold',
                        active ? 'text-amber-500' : 'text-muted-foreground'
                      )}>
                        {active ? activeLabel : inactiveLabel}
                      </p>
                    ) : (
                      <p className="mt-2 text-2xl font-bold tabular-nums">
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
                      <SensorChart
                        deviceId={device.id}
                        deviceType={device.type as DeviceType}
                        currentValue={device.status}
                      />
                    )}
                  </>
                );
              })()}

              {/* Ventil-Status */}
              {isValve && (
                <p className={cn('mt-2 text-base font-semibold', isActive ? 'text-teal-500' : 'text-muted-foreground')}>
                  {isActive ? 'Offen' : 'Geschlossen'}
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
                  <span className="w-fit flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium py-1 px-2 rounded-full bg-emerald-500/10">
                    <Bluetooth className="h-3 w-3 shrink-0" />
                    BLE Bridge
                  </span>
                </div>
              )}

              {/* Shelly-Konfigurationsbereich (LED, Auto-Aus, Verbrauch) */}
              {useBridge && toggleable && !sensor && (
                <ShellyPlugPanel deviceId={device.id} />
              )}

              {/* Geräteverlauf */}
              {toggleable && !sensor && !isCover && (
                <div className="mt-2">
                  <DeviceHistory deviceId={device.id} deviceName={device.name} />
                </div>
              )}

              {/* Rollladen-Steuerung */}
              {isCover && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleCoverCmd(device, 'open')}
                    disabled={isDisabled}
                    className={cn(
                      'cursor-pointer flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-sm font-medium transition-colors',
                      isOn ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-muted hover:bg-accent',
                      isDisabled && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <ChevronUp className="h-4 w-4" /> Öffnen
                  </button>
                  <button
                    onClick={() => handleCoverCmd(device, 'stop')}
                    disabled={isDisabled}
                    className={cn(
                      'cursor-pointer flex items-center justify-center p-2 rounded-xl bg-muted hover:bg-accent transition-colors',
                      isDisabled && 'opacity-40 cursor-not-allowed'
                    )}
                    aria-label="Stop"
                  >
                    <Square className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleCoverCmd(device, 'close')}
                    disabled={isDisabled}
                    className={cn(
                      'cursor-pointer flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-sm font-medium transition-colors bg-muted hover:bg-accent',
                      isDisabled && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <ChevronDown className="h-4 w-4" /> Schließen
                  </button>
                </div>
              )}

              {/* Rollladen-Position */}
              {isCover && device.status && !['on','off','open','close','stop','unknown'].includes(device.status) && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Position: <span className="font-semibold text-foreground">{device.status}%</span>
                </p>
              )}

              {/* Thermostat-Steuerung */}
              {isTherm && (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Heizung</p>
                    <button
                      onClick={async () => {
                        const newStatus = isActive ? 'off' : 'auto';
                        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: newStatus } : d));
                        try { await api.setDeviceStatus(device.id, newStatus); }
                        catch { setDevices(prev => prev.map(d => d.id === device.id ? device : d)); }
                      }}
                      className={cn(
                        'cursor-pointer text-xs px-2.5 py-1 rounded-full font-medium transition-colors',
                        isActive
                          ? 'bg-orange-500/15 text-orange-500 hover:bg-orange-500/25'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {isActive ? 'Aktiv' : 'Aus'}
                    </button>
                  </div>
                  {device.status && !['on','off','auto','unknown'].includes(device.status) && (
                    <p className="text-xs text-muted-foreground">
                      Aktuell: <span className="font-semibold text-foreground">{device.status}°C</span>
                    </p>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Solltemperatur</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSetpointChange(device, -0.5)}
                        className="cursor-pointer h-9 w-9 rounded-xl bg-muted hover:bg-accent flex items-center justify-center transition-colors shrink-0"
                        aria-label="-0.5°C"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <div className="flex-1 text-center">
                        <span className="text-2xl font-bold tabular-nums">
                          {(setpoints.get(device.id) ?? 20).toFixed(1)}
                        </span>
                        <span className="text-sm text-muted-foreground ml-0.5">°C</span>
                      </div>
                      <button
                        onClick={() => handleSetpointChange(device, +0.5)}
                        className="cursor-pointer h-9 w-9 rounded-xl bg-muted hover:bg-accent flex items-center justify-center transition-colors shrink-0"
                        aria-label="+0.5°C"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Helligkeit (Dimmer / LED / RGB) */}
              {(isDimmer || isRgb || isLed) && (
                <div className="mt-3 space-y-2 pr-14">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Helligkeit</p>
                    <span className="text-xs font-semibold tabular-nums">{dimmerLevels.get(device.id) ?? 50}%</span>
                  </div>
                  <input
                    type="range"
                    min={0} max={100} step={5}
                    value={dimmerLevels.get(device.id) ?? 50}
                    onChange={e => setDimmerLevels(m => new Map(m).set(device.id, Number(e.target.value)))}
                    onPointerUp={e => handleDimmerChange(device, Number((e.target as HTMLInputElement).value))}
                    className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>0%</span><span>50%</span><span>100%</span>
                  </div>
                </div>
              )}
              {isRgb && (
                <p className="mt-1.5 text-xs text-muted-foreground pr-14">
                  🎨 Farbe via MQTT-Attribut <code className="text-[10px] bg-muted px-1 py-0.5 rounded">color</code>
                </p>
              )}

              {/* Lüfter-Stufen */}
              {isFan && (
                <div className="mt-3 pr-14">
                  <p className="text-xs text-muted-foreground mb-1.5">Lüfterstufe</p>
                  <div className="flex gap-1.5">
                    {([['Niedrig','low'],['Mittel','medium'],['Hoch','high']] as const).map(([lbl, val]) => (
                      <button
                        key={val}
                        onClick={() => handleFanSpeedSet(device, val)}
                        disabled={isDisabled}
                        className={cn(
                          'cursor-pointer flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors',
                          device.status === val
                            ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 font-semibold'
                            : 'bg-muted hover:bg-accent text-muted-foreground',
                          isDisabled && 'opacity-40 cursor-not-allowed'
                        )}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Taster-Info */}
              {isButton && (
                <p className="mt-2 text-xs text-muted-foreground">Eingang – kein Ausgang</p>
              )}

              {/* Power-Button (absolut unten rechts) */}
              {toggleable && !sensor && !isCover && (
                <button
                  onClick={() => handleToggle(device)}
                  disabled={isDisabled}
                  aria-label={isActive ? 'Ausschalten' : 'Einschalten'}
                  className={cn(
                    'absolute bottom-3 right-3 h-11 w-11 rounded-full',
                    'flex items-center justify-center transition-all',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background',
                    'active:scale-90',
                    isActive
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


