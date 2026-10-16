'use client';

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Device, Room, Scene } from '@/lib/api';
import {
  ActionDeviceStatus, ActionFormItem, ActionType, DeviceStatus, SWITCHABLE_TYPES, ThermostatMode,
} from '@/lib/automation-form';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DeviceSelect, FieldLabel, TextInput } from '@/components/automation/fields';
import { iconFor, labelFor } from '@/components/automation/BlockPicker';

export default function ActionCard({
  action, canRemove, canMoveUp, canMoveDown,
  devices, rooms, scenes, onChange, onRemove, onMove,
}: {
  action: ActionFormItem;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  devices: Device[];
  rooms: Room[];
  scenes: Scene[];
  onChange: (patch: Partial<ActionFormItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const switchable = devices.filter((d) => SWITCHABLE_TYPES.includes(d.type));
  const thermostats = devices.filter((d) => d.type === 'thermostat');
  const wakeOnly = switchable.filter((d) => d.type !== 'computer');
  const target = devices.find((d) => String(d.id) === action.deviceId);
  const isCover = target?.type === 'cover';
  const isComputer = target?.type === 'computer';
  const Icon = iconFor('action', action.type);

  const pickDevice = (v: string) => {
    const next = devices.find((d) => String(d.id) === v);
    const patch: Partial<ActionFormItem> = { deviceId: v };
    if (next?.type === 'cover' && !['open', 'close', 'stop'].includes(action.deviceStatus)) patch.deviceStatus = 'open';
    else if (next?.type === 'computer') {
      patch.deviceStatus = 'on';
      if (action.type === 'toggle_device') patch.type = 'set_device_status';
    } else if (next && next.type !== 'cover' && ['open', 'close', 'stop'].includes(action.deviceStatus)) {
      patch.deviceStatus = 'on';
    }
    onChange(patch);
  };

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm font-semibold truncate flex-1">{labelFor('action', action.type)}</p>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label="Nach oben">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label="Nach unten">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" disabled={!canRemove} onClick={onRemove} aria-label="Entfernen">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {action.type === 'set_device_status' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Gerät</FieldLabel>
            <DeviceSelect value={action.deviceId} onChange={pickDevice} devices={switchable} rooms={rooms} />
          </div>
          <div className="space-y-1">
            <FieldLabel>Aktion</FieldLabel>
            <Select value={action.deviceStatus} onValueChange={(v) => onChange({ deviceStatus: v as ActionDeviceStatus })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {isCover ? (
                  <>
                    <SelectItem value="open">öffnen</SelectItem>
                    <SelectItem value="close">schließen</SelectItem>
                    <SelectItem value="stop">stopp</SelectItem>
                  </>
                ) : isComputer ? (
                  <SelectItem value="on">starten</SelectItem>
                ) : (
                  <>
                    <SelectItem value="on">einschalten</SelectItem>
                    <SelectItem value="off">ausschalten</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {action.type === 'toggle_device' && (
        <div className="space-y-1">
          <FieldLabel>Gerät</FieldLabel>
          <DeviceSelect value={action.deviceId} onChange={pickDevice} devices={wakeOnly} rooms={rooms} />
        </div>
      )}

      {(action.type === 'delayed_off' || action.type === 'delayed_on') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Gerät</FieldLabel>
            <DeviceSelect
              value={action.deviceId}
              onChange={pickDevice}
              devices={action.type === 'delayed_on' ? switchable : wakeOnly}
              rooms={rooms}
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Minuten</FieldLabel>
            <TextInput type="number" value={action.delayMinutes} onChange={(v) => onChange({ delayMinutes: v })} placeholder="10" />
          </div>
        </div>
      )}

      {action.type === 'set_room_devices' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Raum</FieldLabel>
            <Select value={action.roomId} onValueChange={(v) => onChange({ roomId: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Raum wählen…" /></SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.icon} {r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <FieldLabel>Aktion</FieldLabel>
            <Select value={action.roomStatus} onValueChange={(v) => onChange({ roomStatus: v as DeviceStatus })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on">alle einschalten</SelectItem>
                <SelectItem value="off">alle ausschalten</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {action.type === 'activate_scene' && (
        <div className="space-y-1">
          <FieldLabel>Szene</FieldLabel>
          {scenes.length > 0 ? (
            <Select value={action.sceneId} onValueChange={(v) => onChange({ sceneId: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Szene wählen…" /></SelectTrigger>
              <SelectContent>
                {scenes.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.icon ? `${s.icon} ` : ''}{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : <p className="text-xs text-muted-foreground py-2">Keine Szenen vorhanden.</p>}
        </div>
      )}

      {action.type === 'notify' && (
        <div className="space-y-1">
          <FieldLabel>Nachricht</FieldLabel>
          <TextInput value={action.notifyMessage} onChange={(v) => onChange({ notifyMessage: v })} placeholder="z.B. Fenster ist offen" />
        </div>
      )}

      {thermostatField(action.type) && (
        <ThermoFields action={action} thermostats={thermostats} rooms={rooms} onChange={onChange} pickDevice={pickDevice} />
      )}
    </div>
  );
}

function thermostatField(type: ActionType) {
  return type.startsWith('set_thermostat_') || type.startsWith('thermostat_');
}

function ThermoFields({
  action, thermostats, rooms, onChange, pickDevice,
}: {
  action: ActionFormItem;
  thermostats: Device[];
  rooms: Room[];
  onChange: (patch: Partial<ActionFormItem>) => void;
  pickDevice: (v: string) => void;
}) {
  const device = (
    <div className="space-y-1">
      <FieldLabel>Thermostat</FieldLabel>
      {thermostats.length > 0
        ? <DeviceSelect value={action.deviceId} onChange={pickDevice} devices={thermostats} rooms={rooms} />
        : <p className="text-xs text-muted-foreground py-2">Keine Thermostate vorhanden.</p>}
    </div>
  );

  if (action.type === 'set_thermostat_setpoint') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Sollwert (°C)</FieldLabel>
          <TextInput type="number" value={action.setpoint} onChange={(v) => onChange({ setpoint: v })} placeholder="21" />
        </div>
      </div>
    );
  }
  if (action.type === 'set_thermostat_mode') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Modus</FieldLabel>
          <Select value={action.thermostatMode} onValueChange={(v) => onChange({ thermostatMode: v as ThermostatMode })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="heat">An</SelectItem>
              <SelectItem value="off">Aus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  if (action.type === 'set_thermostat_child_lock') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Kindersicherung</FieldLabel>
          <Select value={action.childLock ? 'true' : 'false'} onValueChange={(v) => onChange({ childLock: v === 'true' })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">an</SelectItem>
              <SelectItem value="false">aus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  if (action.type === 'set_thermostat_open_window') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Offenes Fenster</FieldLabel>
          <Select value={action.openWindow ? 'true' : 'false'} onValueChange={(v) => onChange({ openWindow: v === 'true' })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">an</SelectItem>
              <SelectItem value="false">aus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }
  if (action.type === 'set_thermostat_calibration') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Kalibrierung (°C)</FieldLabel>
          <TextInput type="number" value={action.calibration} onChange={(v) => onChange({ calibration: v })} placeholder="0" />
        </div>
      </div>
    );
  }
  if (action.type === 'set_thermostat_frost_protection') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Frostschutz (°C)</FieldLabel>
          <TextInput type="number" value={action.frostProtection} onChange={(v) => onChange({ frostProtection: v })} placeholder="5" />
        </div>
      </div>
    );
  }
  if (action.type === 'thermostat_boost') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {device}
        <div className="space-y-1">
          <FieldLabel>Dauer (Minuten)</FieldLabel>
          <TextInput type="number" value={action.boostDuration} onChange={(v) => onChange({ boostDuration: v })} placeholder="30" />
        </div>
      </div>
    );
  }
  if (action.type === 'thermostat_timer') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">{device}</div>
        <div className="space-y-1">
          <FieldLabel>Dauer (Minuten)</FieldLabel>
          <TextInput type="number" value={action.timerDuration} onChange={(v) => onChange({ timerDuration: v })} placeholder="60" />
        </div>
        <div className="space-y-1">
          <FieldLabel>Ziel (°C)</FieldLabel>
          <TextInput type="number" value={action.timerTemp} onChange={(v) => onChange({ timerTemp: v })} placeholder="21" />
        </div>
      </div>
    );
  }
  return device;
}
