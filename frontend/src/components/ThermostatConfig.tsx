'use client';

import { Device, Room } from '@/lib/api';
import { isRoomTempSensor, mergeDeviceLists, temperatureSourceDeviceId } from '@/lib/devices';
import { encodeCapStatus, getCalibration, getFrostProtection, isChildLockOn, isOpenWindowOn } from '@/lib/thermostat-capabilities';
import ThermostatAdvancedPanel from '@/components/ThermostatAdvancedPanel';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lock, Unlock, Wind } from 'lucide-react';

export default function ThermostatConfig({
  device,
  devices,
  storeDevices,
  storeRooms,
  roomId,
  disabled,
  onCap,
  onTempSource,
  onUpdated,
}: {
  device: Device;
  devices: Device[];
  storeDevices: Device[];
  storeRooms: Room[];
  roomId: number;
  disabled: boolean;
  onCap: (device: Device, status: string, attrs: Record<string, unknown>) => void;
  onTempSource: (device: Device, sensorId: number | null) => void;
  onUpdated: (device: Device) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isChildLockOn(device.attributes) ? <Lock className="h-5 w-5 text-orange-500 shrink-0" /> : <Unlock className="h-5 w-5 text-muted-foreground shrink-0" />}
          <span className="text-sm font-medium">Kindersicherung</span>
        </div>
        <Switch
          checked={isChildLockOn(device.attributes)}
          disabled={disabled}
          onCheckedChange={(on) => onCap(device, encodeCapStatus('child_lock', on ? 'LOCK' : 'UNLOCK'), { child_lock: on ? 'LOCK' : 'UNLOCK' })}
        />
      </div>

      <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Wind className="h-5 w-5 text-sky-500 shrink-0" />
          <span className="text-sm font-medium">Offenes Fenster</span>
        </div>
        <Switch
          checked={isOpenWindowOn(device.attributes)}
          disabled={disabled}
          onCheckedChange={(on) => onCap(device, encodeCapStatus('open_window', on ? 'ON' : 'OFF'), { open_window: on ? 'ON' : 'OFF' })}
        />
      </div>

      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <p className="text-sm font-medium">Raumtemperatur von</p>
        <Select
          value={temperatureSourceDeviceId(device) != null ? String(temperatureSourceDeviceId(device)) : 'internal'}
          disabled={disabled}
          onValueChange={(v) => { void onTempSource(device, v === 'internal' ? null : Number(v)); }}
        >
          <SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">Ventil (intern)</SelectItem>
            {(() => {
              const catalog = mergeDeviceLists(storeDevices, devices);
              const selectedId = temperatureSourceDeviceId(device);
              const sources = catalog.filter(isRoomTempSensor).slice().sort((a, b) => {
                const ar = a.room_id === roomId ? 0 : 1;
                const br = b.room_id === roomId ? 0 : 1;
                if (ar !== br) return ar - br;
                return a.name.localeCompare(b.name, 'de');
              });
              if (selectedId && !sources.some((s) => s.id === selectedId)) {
                const extra = catalog.find((s) => s.id === selectedId);
                if (extra) sources.unshift(extra);
              }
              return sources.map((s) => {
                const roomName = storeRooms.find(r => r.id === s.room_id)?.name;
                return (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {roomName && s.room_id !== roomId ? `${roomName} · ${s.name}` : s.name}
                  </SelectItem>
                );
              });
            })()}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Der Fühler am Heizkörper misst oft zu warm. Ein Raumfühler kann mehrere Ventile versorgen.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="rounded-2xl border bg-card p-4 space-y-2 block">
          <span className="text-sm font-medium">Kalibrierung (°C)</span>
          <input
            type="number"
            step={0.2}
            min={-12.7}
            max={12.7}
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
            defaultValue={getCalibration(device.attributes)}
            key={`cal-${device.id}-${getCalibration(device.attributes)}`}
            onBlur={(e) => {
              const raw = Number(e.target.value);
              if (!Number.isFinite(raw)) return;
              const val = Math.round(Math.min(12.7, Math.max(-12.7, raw)) * 5) / 5;
              if (val === getCalibration(device.attributes)) return;
              onCap(device, encodeCapStatus('local_temperature_calibration', String(val)), { local_temperature_calibration: val });
            }}
          />
        </label>
        <label className="rounded-2xl border bg-card p-4 space-y-2 block">
          <span className="text-sm font-medium">Frostschutz (°C)</span>
          <input
            type="number"
            step={0.5}
            min={4}
            max={35}
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
            defaultValue={getFrostProtection(device.attributes)}
            key={`frost-${device.id}-${getFrostProtection(device.attributes)}`}
            onBlur={(e) => {
              const raw = Number(e.target.value);
              if (!Number.isFinite(raw)) return;
              const val = Math.round(Math.min(35, Math.max(4, raw)) * 2) / 2;
              if (val === getFrostProtection(device.attributes)) return;
              onCap(device, encodeCapStatus('frost_protection_temperature', String(val)), { frost_protection_temperature: val });
            }}
          />
        </label>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <ThermostatAdvancedPanel device={device} disabled={disabled} onUpdated={onUpdated} />
      </div>
    </div>
  );
}
