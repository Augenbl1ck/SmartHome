'use client';

import { Shield } from 'lucide-react';
import { Device, Room } from '@/lib/api';
import { FormState, SWITCHABLE_TYPES } from '@/lib/automation-form';
import { DeviceSelect, FieldLabel } from '@/components/automation/fields';
import { LOCK_CHOICES } from '@/components/automation/BlockPicker';

export default function LockCard({
  form, devices, rooms, onChange,
}: {
  form: FormState;
  devices: Device[];
  rooms: Room[];
  onChange: (patch: Partial<FormState>) => void;
}) {
  const choice = LOCK_CHOICES.find((c) => c.type === form.blockStatus) ?? LOCK_CHOICES[0];
  const Icon = choice.icon ?? Shield;
  const list = devicesForCommand(form.blockStatus, devices);

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{choice.label}</p>
          <p className="text-xs text-muted-foreground">{choice.hint}</p>
        </div>
      </div>
      <div className="space-y-1">
        <FieldLabel>Gerät</FieldLabel>
        {list.length > 0 ? (
          <DeviceSelect
            value={form.blockDeviceId}
            devices={list}
            rooms={rooms}
            onChange={(v) => onChange({ blockDeviceId: v })}
          />
        ) : (
          <p className="text-sm text-muted-foreground py-2">Keine passenden Geräte.</p>
        )}
      </div>
    </div>
  );
}

function devicesForCommand(status: FormState['blockStatus'], devices: Device[]): Device[] {
  if (status === 'heat' || status === 'off') {
    const thermos = devices.filter((d) => d.type === 'thermostat');
    if (status === 'heat') return thermos;
    return [
      ...devices.filter((d) => SWITCHABLE_TYPES.includes(d.type) && d.type !== 'cover' && d.type !== 'valve'),
      ...thermos,
    ];
  }
  if (status === 'open' || status === 'close') {
    return devices.filter((d) => d.type === 'cover' || d.type === 'valve');
  }
  return devices.filter((d) => SWITCHABLE_TYPES.includes(d.type) && d.type !== 'cover' && d.type !== 'valve');
}
