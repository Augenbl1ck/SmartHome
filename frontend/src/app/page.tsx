'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Home, Thermometer, Zap, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSmartHomeStore } from '@/store/smarthome';

export default function DashboardPage() {
  const { rooms, devices, fetchRooms, fetchDevices } = useSmartHomeStore();

  useEffect(() => {
    fetchRooms();
    fetchDevices();
  }, [fetchRooms, fetchDevices]);

  const activeDevices = devices.filter((d) => d.status === 'on').length;
  const tempSensors = devices.filter((d) => d.type === 'sensor_temperature');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <Home className="h-4 w-4" /> Räume
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{rooms.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
              <Zap className="h-4 w-4" /> Geräte aktiv
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{activeDevices}</p>
            <p className="text-xs text-muted-foreground">von {devices.length}</p>
          </CardContent>
        </Card>

        {tempSensors.slice(0, 2).map((sensor) => (
          <Card key={sensor.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Thermometer className="h-4 w-4" /> {sensor.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {sensor.status !== 'unknown' ? `${sensor.status}°C` : '–'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Räume</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => {
            const roomDevices = devices.filter((d) => d.room_id === room.id);
            const active = roomDevices.filter((d) => d.status === 'on').length;
            return (
              <Link key={room.id} href={`/rooms/${room.id}`}>
                <Card className="hover:bg-accent transition-colors cursor-pointer">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-base">{room.name}</CardTitle>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Badge variant="secondary">{roomDevices.length} Geräte</Badge>
                    {active > 0 && <Badge className="bg-yellow-500">{active} an</Badge>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

