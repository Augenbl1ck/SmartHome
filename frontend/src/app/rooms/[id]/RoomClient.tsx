'use client';

import { useEffect, useState } from 'react';
import { api, Device, Room } from '@/lib/api';
import { shellyBle, BleState } from '@/lib/bluetooth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { deviceIcons, deviceLabels, isSensor, isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { Bluetooth, BluetoothConnected, BluetoothOff } from 'lucide-react';

interface Props {
  room: Room;
  initialDevices: Device[];
}

function isBleDevice(device: Device): boolean {
  return device.attributes?.protocol === 'bluetooth_shelly_gen3';
}

function BleButton({ deviceId, state, onConnect, onDisconnect }: {
  deviceId: number;
  state: BleState;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (state === 'connected') {
    return (
      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 px-2" onClick={onDisconnect}>
        <BluetoothConnected className="h-3.5 w-3.5 text-blue-500" />
        Verbunden
      </Button>
    );
  }
  if (state === 'connecting') {
    return (
      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 px-2" disabled>
        <Bluetooth className="h-3.5 w-3.5 animate-pulse text-blue-400" />
        Verbinde…
      </Button>
    );
  }
  if (state === 'error') {
    return (
      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 px-2 text-destructive border-destructive/40" onClick={onConnect}>
        <BluetoothOff className="h-3.5 w-3.5" />
        Fehler – Erneut
      </Button>
    );
  }
  return (
    <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 px-2" onClick={onConnect}>
      <Bluetooth className="h-3.5 w-3.5" />
      Verbinden
    </Button>
  );
}

export default function RoomClient({ room, initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [bleStates, setBleStates] = useState<Map<number, BleState>>(new Map());

  // BLE-State-Listener registrieren/deregistrieren
  useEffect(() => {
    const bleDevices = initialDevices.filter(isBleDevice);
    for (const d of bleDevices) {
      shellyBle.onStateChange(d.id, (state) => {
        setBleStates((prev) => new Map(prev).set(d.id, state));
      });
    }
    return () => {
      for (const d of bleDevices) shellyBle.offStateChange(d.id);
    };
  }, [initialDevices]);

  const getBleState = (id: number): BleState =>
    bleStates.get(id) ?? (shellyBle.isConnected(id) ? 'connected' : 'disconnected');

  const [bleError, setBleError] = useState<string | null>(null);

  const handleBleConnect = async (device: Device) => {
    setBleError(null);
    try {
      await shellyBle.connect(device.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('User cancelled')) setBleError(msg);
    }
  };

  const handleToggle = async (device: Device) => {
    if (pending.has(device.id)) return;

    const newStatus = device.status === 'on' ? 'off' : 'on';

    setPending((p) => new Set(p).add(device.id));
    // Optimistic update
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, status: newStatus } : d))
    );

    try {
      if (isBleDevice(device)) {
        if (!shellyBle.isConnected(device.id)) {
          throw new Error('Gerät nicht per Bluetooth verbunden');
        }
        // BLE-Befehl direkt an Gerät
        await shellyBle.switchSet(device.id, newStatus === 'on');
        // Status in DB aktualisieren (MQTT wird für BLE-Geräte im Backend ignoriert)
        const updated = await api.toggleDevice(device.id);
        setDevices((prev) => prev.map((d) => (d.id === device.id ? updated : d)));
      } else {
        // Normaler MQTT/API-Toggle
        const updated = await api.toggleDevice(device.id);
        setDevices((prev) => prev.map((d) => (d.id === device.id ? updated : d)));
      }
    } catch (err) {
      // Zurücksetzen bei Fehler
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? device : d))
      );
      console.warn('Toggle fehlgeschlagen:', err);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(device.id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{room.name}</h1>

      {bleError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive whitespace-pre-wrap">
          <p className="font-medium mb-1">Bluetooth-Verbindung fehlgeschlagen</p>
          <p className="text-xs">{bleError}</p>
          <button className="mt-2 text-xs underline" onClick={() => setBleError(null)}>Schließen</button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => {
          const Icon = deviceIcons[device.type as DeviceType] ?? deviceIcons.other;
          const label = deviceLabels[device.type as DeviceType] ?? 'Gerät';
          const toggleable = isToggleable(device.type as DeviceType);
          const sensor = isSensor(device.type as DeviceType);
          const ble = isBleDevice(device);
          const bleState = getBleState(device.id);
          const bleConnected = bleState === 'connected';

          return (
            <Card key={device.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <CardTitle className="text-base truncate">{device.name}</CardTitle>
                </div>
                {toggleable && (
                  <Switch
                    checked={device.status === 'on'}
                    disabled={pending.has(device.id) || (ble && !bleConnected)}
                    onCheckedChange={() => handleToggle(device)}
                  />
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{label}</Badge>
                  {ble && (
                    <BleButton
                      deviceId={device.id}
                      state={bleState}
                      onConnect={() => handleBleConnect(device)}
                      onDisconnect={() => shellyBle.disconnect(device.id)}
                    />
                  )}
                </div>
                {sensor ? (
                  <p className="text-2xl font-bold mt-1">
                    {device.status !== 'unknown' ? device.status : '–'}
                    {device.type === 'sensor_temperature' && '°C'}
                    {device.type === 'sensor_humidity' && '%'}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Status: <span className="font-medium">{device.status}</span>
                  </p>
                )}
                {ble && !bleConnected && toggleable && (
                  <p className="text-xs text-muted-foreground">
                    Bluetooth verbinden um zu schalten
                  </p>
                )}
                {device.last_seen && (
                  <p className="text-xs text-muted-foreground">
                    Zuletzt: {new Date(device.last_seen).toLocaleString('de-DE')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}

        {devices.length === 0 && (
          <p className="text-muted-foreground col-span-full">Keine Geräte in diesem Raum.</p>
        )}
      </div>
    </div>
  );
}

