'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSmartHomeStore } from '@/store/smarthome';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { deviceIcons, deviceLabels, isSensor, isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const { rooms, devices, fetchRooms, fetchDevices, toggleDevice } = useSmartHomeStore();

  useEffect(() => {
    fetchRooms();
    fetchDevices();
  }, [fetchRooms, fetchDevices]);

  const room = rooms.find((r) => r.id === Number(id));
  const roomDevices = devices.filter((d) => d.room_id === Number(id));

  if (!room) return <p className="text-muted-foreground">Raum wird geladen…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{room.name}</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {roomDevices.map((device) => {
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
                    onCheckedChange={() => toggleDevice(device.id)}
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
                    Zuletzt gesehen: {new Date(device.last_seen).toLocaleString('de-DE')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {roomDevices.length === 0 && (
        <p className="text-muted-foreground">Keine Geräte in diesem Raum.</p>
      )}
    </div>
  );
}
