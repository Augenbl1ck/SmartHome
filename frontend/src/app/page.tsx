import Link from 'next/link';
import { serverApi } from '@/lib/api-server';
import { cn } from '@/lib/utils';
import { isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import QuickAccess from '@/components/QuickAccess';

export default async function DashboardPage() {
  const [rooms, devices] = await Promise.all([
    serverApi.getRooms(),
    serverApi.getDevices(),
  ]);

  const activeDevices = devices.filter((d) => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
  const toggleableDevices = devices.filter((d) => isToggleable(d.type as DeviceType)).length;
  const tempSensors = devices.filter((d) => d.type === 'sensor_temperature');
  const humSensors  = devices.filter((d) => d.type === 'sensor_humidity');

  return (
    <div className="space-y-6">

      {/* ── Statistiken ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Aktiv</p>
          <p className="text-4xl font-bold mt-1 tabular-nums">{activeDevices}</p>
          <p className="text-xs text-muted-foreground mt-0.5">von {toggleableDevices} schaltbar</p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Räume</p>
          <p className="text-4xl font-bold mt-1 tabular-nums">{rooms.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Bereiche</p>
        </div>

        {tempSensors.slice(0, 1).map((s) => (
          <div key={s.id} className="rounded-xl border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{s.name}</p>
            <p className="text-4xl font-bold mt-1 tabular-nums">
              {s.status !== 'unknown' ? s.status : '–'}
              <span className="text-xl font-medium text-muted-foreground">°C</span>
            </p>
          </div>
        ))}

        {humSensors.slice(0, 1).map((s) => (
          <div key={s.id} className="rounded-xl border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{s.name}</p>
            <p className="text-4xl font-bold mt-1 tabular-nums">
              {s.status !== 'unknown' ? s.status : '–'}
              <span className="text-xl font-medium text-muted-foreground">%</span>
            </p>
          </div>
        ))}
      </div>

      {/* ── Schnellzugriff ──────────────────────────────────────── */}
      <QuickAccess initialDevices={devices} />

      {/* ── Räume ───────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Räume</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.map((room) => {
            const roomDevices = devices.filter((d) => d.room_id === room.id);
            const active = roomDevices.filter((d) => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
            return (
              <Link key={room.id} href={`/rooms/${room.id}`}>
                <div className={cn(
                  'rounded-xl border p-4 flex flex-col gap-2 min-h-[120px] cursor-pointer',
                  'transition-all hover:bg-accent active:scale-[0.97]',
                  active > 0 ? 'border-green-500/20 bg-green-500/[0.03]' : 'bg-card'
                )}>
                  <span className="text-4xl leading-none select-none">{room.icon ?? '🏠'}</span>
                  <div className="mt-auto">
                    <p className="font-semibold text-sm leading-tight">{room.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {active > 0 && (
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {active > 0
                          ? `${active} an`
                          : roomDevices.length > 0
                          ? 'Alle aus'
                          : 'Keine Geräte'}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {rooms.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            Noch keine Räume vorhanden. Gehe zu Einstellungen um welche hinzuzufügen.
          </p>
        )}
      </div>
    </div>
  );
}


