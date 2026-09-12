'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, Device, DeviceType } from '@/lib/api';
import { deviceIcons, isSensor, isComputer, commandBlocked, nextCommandBlocked } from '@/lib/devices';
import { Bluetooth, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shellyBle } from '@/lib/bluetooth';
import { emitDeviceUpdate, DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { toast } from 'sonner';
import { useKiosk } from '@/components/KioskProvider';

function isBle(device: Device): boolean {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

/** Geräte die per Tap An/Aus schalten */
function isOnOffToggle(type: DeviceType): boolean {
  return ['light', 'plug', 'switch', 'dimmer', 'rgb', 'led', 'fan'].includes(type);
}

function isCoverLike(type: DeviceType): boolean {
  return type === 'cover' || type === 'valve';
}

function isWakeable(type: DeviceType): boolean {
  return isComputer(type);
}

function statusLabel(device: Device): string {
  const type = device.type as DeviceType;
  const attrs = device.attributes ?? {};

  if (type === 'thermostat') {
    const local = attrs.local_temperature;
    const set = attrs.setpoint;
    const parts: string[] = [];
    if (typeof local === 'number' || (typeof local === 'string' && local !== '')) {
      const n = Number(local);
      if (Number.isFinite(n)) parts.push(`${n.toFixed(1)}°C`);
    } else if (typeof attrs.temperature === 'number' || (typeof attrs.temperature === 'string' && attrs.temperature !== '')) {
      const n = Number(attrs.temperature);
      if (Number.isFinite(n)) parts.push(`${n.toFixed(1)}°C`);
    }
    if (typeof set === 'number' || (typeof set === 'string' && set !== '')) {
      parts.push(`Soll ${Number(set).toFixed(1)}°C`);
    }
    if (parts.length) return parts.join(' · ');
    return device.status === 'heat' ? 'Heizen' : device.status === 'off' ? 'Aus' : (device.status || '—');
  }

  if (isSensor(type)) {
    if (type === 'sensor_door') return device.status === 'open' ? 'Offen' : device.status === 'closed' ? 'Geschlossen' : device.status;
    if (type === 'sensor_motion') return device.status === 'on' ? 'Bewegung' : 'Ruhe';
    if (type === 'energy_meter' && attrs.power_w != null) return `${Number(attrs.power_w).toFixed(0)} W`;
    const temp = attrs.local_temperature ?? attrs.temperature ?? (type === 'sensor_temperature' ? device.status : null);
    const hum = attrs.humidity ?? (type === 'sensor_humidity' ? device.status : null);
    const parts: string[] = [];
    if (temp !== '' && temp != null && !Number.isNaN(Number(temp))) parts.push(`${Number(temp).toFixed(1)}°C`);
    if (hum !== '' && hum != null && !Number.isNaN(Number(hum))) parts.push(`${Number(hum).toFixed(0)}%`);
    if (parts.length) return parts.join(' · ');
    return device.status || '—';
  }

  if (isCoverLike(type)) {
    if (device.status === 'open') return 'Offen';
    if (device.status === 'close' || device.status === 'closed') return 'Geschlossen';
    if (device.status === 'stop') return 'Stopp';
    if (!['on', 'off', 'unknown', ''].includes(device.status) && !Number.isNaN(Number(device.status))) {
      return `${device.status}%`;
    }
    return device.status || '—';
  }

  return device.status === 'on' ? 'An' : 'Aus';
}

function isActiveLook(device: Device): boolean {
  const type = device.type as DeviceType;
  if (isOnOffToggle(type)) return device.status === 'on';
  if (isCoverLike(type)) return device.status === 'open';
  if (type === 'thermostat') return device.status === 'heat' || String(device.attributes?.running_state).toLowerCase() === 'heat';
  if (type === 'computer') return device.status === 'on';
  if (type === 'sensor_motion') return device.status === 'on';
  if (type === 'sensor_door') return device.status === 'open';
  return false;
}

interface Props {
  title: string;
  deviceIds: number[];
  initialDevices: Device[];
}

export default function DeviceFieldPanel({ title, deviceIds, initialDevices }: Props) {
  const { kioskMode } = useKiosk();
  const [devices, setDevices] = useState(initialDevices);
  const [toggling, setToggling] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    const bleDevices = initialDevices.filter(isBle);
    for (const d of bleDevices) {
      shellyBle.onStateChange(d.id, forceUpdate);
    }
    return () => { for (const d of bleDevices) shellyBle.offStateChange(d.id); };
  }, [initialDevices, forceUpdate]);

  useEffect(() => {
    setDevices(prev => prev.map(d => {
      const fresh = initialDevices.find(f => f.id === d.id);
      return fresh && !toggling.has(d.id) ? { ...d, ...fresh } : d;
    }));
  }, [initialDevices, toggling]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);
    return () => window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
  }, []);

  const fieldDevices = useMemo(() => {
    const byId = new Map(devices.map(d => [d.id, d]));
    return deviceIds.map(id => byId.get(id)).filter((d): d is Device => !!d);
  }, [devices, deviceIds]);

  const activate = async (device: Device) => {
    const type = device.type as DeviceType;

    // Sensoren / Thermostate: nur Anzeige → Raum öffnen über Link (kein Tap-Handler)
    if (!isOnOffToggle(type) && !isCoverLike(type) && !isWakeable(type)) return;

    const ble = isBle(device);
    const hasMac = !!(device.attributes?.ble_address as string | undefined)?.trim();

    if (ble && !hasMac && !shellyBle.isConnected(device.id)) {
      setError(`"${device.name}" ist nicht verbunden — bitte zuerst im Raum verbinden.`);
      return;
    }

    setError(null);
    setToggling(t => new Set(t).add(device.id));

    if (isWakeable(type)) {
      if (device.status === 'on') {
        setToggling(t => { const n = new Set(t); n.delete(device.id); return n; });
        return;
      }
      const blockedOn = commandBlocked(device, 'on');
      if (blockedOn) {
        setError(blockedOn.startsWith('Gesperrt') ? blockedOn : `Gesperrt: ${blockedOn}`);
        setToggling(t => { const n = new Set(t); n.delete(device.id); return n; });
        return;
      }
      try {
        await api.setDeviceStatus(device.id, 'on');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Fehler bei "${device.name}": ${msg}`);
      } finally {
        setToggling(t => { const n = new Set(t); n.delete(device.id); return n; });
      }
      return;
    }

    let newStatus: string;
    if (isCoverLike(type)) {
      newStatus = device.status === 'open' ? 'close' : 'open';
    } else {
      newStatus = device.status === 'on' ? 'off' : 'on';
    }

    const blocked = commandBlocked(device, newStatus);
    if (blocked) {
      const msg = blocked.startsWith('Gesperrt') ? blocked : `Gesperrt: ${blocked}`;
      setError(msg);
      toast.warning(msg);
      setToggling(t => { const n = new Set(t); n.delete(device.id); return n; });
      return;
    }

    const prevStatus = device.status;
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: newStatus } : d));
    emitDeviceUpdate(device.id, newStatus);
    try {
      if (isOnOffToggle(type)) {
        if (ble && !hasMac && shellyBle.isSupported()) {
          try { await shellyBle.switchSet(device.id, newStatus === 'on'); } catch { /* Bridge */ }
        }
        const updated = await api.toggleDevice(device.id);
        if (updated.status !== newStatus) {
          setDevices(prev => prev.map(d => d.id === device.id ? updated : d));
          emitDeviceUpdate(device.id, updated.status);
        }
      } else {
        const updated = await api.setDeviceStatus(device.id, newStatus);
        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updated } : d));
        emitDeviceUpdate(device.id, updated.status);
      }
    } catch (err) {
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, status: prevStatus } : d));
      emitDeviceUpdate(device.id, prevStatus);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Fehler bei "${device.name}": ${msg}`);
    } finally {
      setToggling(t => { const n = new Set(t); n.delete(device.id); return n; });
    }
  };

  if (deviceIds.length === 0) return null;

  return (
    <div>
      <div className={cn('flex items-center justify-between', kioskMode ? 'mb-1' : 'mb-3')}>
        <p className={cn('font-medium text-muted-foreground', kioskMode ? 'text-xs' : 'text-sm')}>{title}</p>
        <span className="text-xs text-muted-foreground">{fieldDevices.length} Geräte</span>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive flex-1">{error}</p>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground shrink-0">✕</button>
        </div>
      )}

      {fieldDevices.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-5 text-center text-muted-foreground">
          <p className="text-xs">Keine Geräte in diesem Feld (vielleicht gelöscht).</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {fieldDevices.map(device => {
            const type = device.type as DeviceType;
            const interactive = isOnOffToggle(type) || isCoverLike(type) || (isWakeable(type) && device.status !== 'on');
            const lockReason = interactive ? nextCommandBlocked(device) : undefined;
            const isOn = isActiveLook(device);
            const isRunning = toggling.has(device.id);
            const ble = isBle(device);
            const hasMac = !!(device.attributes?.ble_address as string | undefined)?.trim();
            const connected = !ble || hasMac || shellyBle.isConnected(device.id);
            const Icon = deviceIcons[type];
            const label = statusLabel(device);

            const className = cn(
              'rounded-2xl border p-4 gap-3 flex items-center text-left transition-all w-full',
              interactive && !lockReason && 'cursor-pointer active:scale-95',
              interactive && lockReason && 'cursor-not-allowed opacity-70',
              isOn && connected ? 'bg-amber-500/15 border-amber-400/40 shadow-sm' : 'bg-card border-border',
              isRunning && 'opacity-50',
            );

            const inner = (
              <>
                <div className={cn(
                  'rounded-full flex items-center justify-center shrink-0 transition-colors',
                  kioskMode ? 'h-7 w-7' : 'h-11 w-11',
                  isOn && connected ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground',
                )}>
                  {Icon && <Icon className={kioskMode ? 'h-4 w-4' : 'h-5 w-5'} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('font-medium truncate', kioskMode ? 'text-xs' : 'text-sm')}>{device.name}</p>
                  <p className={cn('text-muted-foreground flex items-center gap-1', kioskMode ? 'text-[10px]' : 'text-xs')}>
                    {ble && <Bluetooth className={cn('h-3 w-3 shrink-0', connected ? 'text-blue-500' : '')} />}
                    {ble && !connected ? 'Nicht verbunden' : lockReason ? lockReason : label}
                  </p>
                </div>
              </>
            );

            if (interactive) {
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => activate(device)}
                  disabled={isRunning || !!lockReason}
                  className={className}
                >
                  {inner}
                </button>
              );
            }

            // Sensor / Thermostat: Link zum Raum
            return (
              <Link
                key={device.id}
                href={device.room_id ? `/rooms/${device.room_id}` : '/'}
                className={className}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
