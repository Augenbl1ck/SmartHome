'use client';

import { useState } from 'react';
import { api, Device, Room } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { deviceIcons, deviceLabels, isSensor, isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';

interface Props {
  room: Room;
  initialDevices: Device[];
}

export default function RoomClient({ room, initialDevices }: Props) {
  const [devices, setDevices] = useState(initialDevices);
  const [pending, setPending] = useState<Set<number>>(new Set());

  const handleToggle = async (device: Device) => {
    // Bereits ein Request für dieses Gerät läuft → ignorieren
    if (pending.has(device.id)) return;

    const newStatus = device.status === 'on' ? 'off' : 'on';

    setPending((p) => new Set(p).add(device.id));
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, status: newStatus } : d))
    );

    try {
      const updated = await api.toggleDevice(device.id);
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? updated : d))
      );
    } catch {
      // Bei Fehler zurücksetzen
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? device : d))
      );
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => {
          const Icon = deviceIcons[device.type as DeviceType] ?? deviceIcons.other;
          const label = deviceLabels[device.type as DeviceType] ?? 'Gerät';
          const toggleable = isToggleable(device.type as DeviceType);
          const sensor = isSensor(device.type as DeviceType);

          return (
            <Card key={device.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{device.name}</CardTitle>
                </div>
                {toggleable && (
                  <Switch
                    checked={device.status === 'on'}
                    disabled={pending.has(device.id)}
                    onCheckedChange={() => handleToggle(device)}
                  />
                )}
              </CardHeader>
              <CardContent className="space-y-1">
                <Badge variant="outline">{label}</Badge>
                {sensor ? (
                  <p className="text-2xl font-bold mt-2">
                    {device.status !== 'unknown' ? device.status : '–'}
                    {device.type === 'sensor_temperature' && '°C'}
                    {device.type === 'sensor_humidity' && '%'}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Status: <span className="font-medium">{device.status}</span>
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
