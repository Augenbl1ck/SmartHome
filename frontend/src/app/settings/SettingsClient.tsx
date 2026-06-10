'use client';

import { useState } from 'react';
import { api, Device, DeviceType, Room } from '@/lib/api';
import { deviceLabels } from '@/lib/devices';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pencil, Plus, Trash2, Wifi } from 'lucide-react';

interface Props {
  initialRooms: Room[];
  initialDevices: Device[];
}

const DEVICE_TYPES: DeviceType[] = [
  'light', 'plug', 'led', 'fan',
  'sensor_temperature', 'sensor_humidity', 'sensor_motion', 'sensor_door', 'other',
];

const ROOM_ICONS = ['🛋️', '🛏️', '🍳', '🚿', '🏠', '💡', '📦'];

// ─── Eingabefeld ────────────────────────────────────────────────────────────
function Input({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <input
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Gerät-Dialog ────────────────────────────────────────────────────────────
type DeviceProtocol = 'simple' | 'shelly_gen3' | 'shelly_gen1' | 'shelly_gen3_http' | 'bluetooth_shelly_gen3';

const PROTOCOLS: { value: DeviceProtocol; label: string; hint: string; isBle?: boolean; isHttp?: boolean }[] = [
  { value: 'simple',                label: 'Einfach (MQTT on/off)',      hint: 'Schickt "on" oder "off" direkt an das MQTT-Topic.' },
  { value: 'shelly_gen3',           label: 'Shelly Gen3 (MQTT RPC)',     hint: 'Topic-Format: shellygen3/shellyplugsg3-XXXXXX — JSON-RPC über MQTT-Broker.' },
  { value: 'shelly_gen1',           label: 'Shelly Gen1/Gen2 (MQTT)',    hint: 'Topic-Format: shellies/shellyplug-s-XXXXXX — Befehl geht an <topic>/relay/0/command.' },
  { value: 'shelly_gen3_http',      label: 'Shelly Gen3 (LAN/HTTP)',     hint: 'Direkter HTTP-Zugriff im selben Netzwerk — ideal für Raspberry Pi. Kein MQTT-Broker nötig. IP-Adresse des Shelly eingeben.', isHttp: true },
  { value: 'bluetooth_shelly_gen3', label: 'Shelly Gen3 (Bluetooth)',    hint: 'Direktverbindung per Bluetooth Low Energy — kein Broker nötig. Nur Chrome/Edge. Im Verbinden-Dialog erscheint das Gerät als "ShellyPlugSG3-XXXXXX".', isBle: true },
];

interface DeviceFormState {
  name: string;
  type: DeviceType;
  room_id: string;
  mqtt_topic: string;
  mqtt_protocol: DeviceProtocol;
  ble_address: string;
  active: boolean;
}

const emptyDevice = (): DeviceFormState => ({
  name: '',
  type: 'light',
  room_id: '',
  mqtt_topic: '',
  mqtt_protocol: 'simple',
  ble_address: '',
  active: true,
});

function deviceToForm(d: Device): DeviceFormState {
  return {
    name: d.name,
    type: d.type,
    room_id: String(d.room_id),
    mqtt_topic: d.mqtt_topic ?? '',
    mqtt_protocol: (d.attributes?.protocol as DeviceProtocol) ?? 'simple',
    ble_address: (d.attributes?.ble_address as string) ?? '',
    active: d.active,
  };
}

// ─── Hauptkomponente ─────────────────────────────────────────────────────────
export default function SettingsClient({ initialRooms, initialDevices }: Props) {
  const [rooms, setRooms] = useState(initialRooms);
  const [devices, setDevices] = useState(initialDevices);

  // Gerät-Dialog
  const [deviceDialog, setDeviceDialog] = useState<{
    open: boolean;
    editing?: Device;
    form: DeviceFormState;
    saving: boolean;
    error: string;
  }>({ open: false, form: emptyDevice(), saving: false, error: '' });

  // Raum-Dialog
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean;
    editing?: Room;
    name: string;
    icon: string;
    saving: boolean;
    error: string;
  }>({ open: false, name: '', icon: '🏠', saving: false, error: '' });

  // Löschen bestätigen
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    type: 'device' | 'room';
    id: number;
    label: string;
  } | null>(null);

  // ── Gerät speichern ────────────────────────────────────────────────────────
  const saveDevice = async () => {
    const { form, editing } = deviceDialog;
    if (!form.name.trim()) {
      setDeviceDialog((s) => ({ ...s, error: 'Name ist erforderlich.' }));
      return;
    }
    if (!form.room_id) {
      setDeviceDialog((s) => ({ ...s, error: 'Bitte einen Raum wählen.' }));
      return;
    }

    setDeviceDialog((s) => ({ ...s, saving: true, error: '' }));
    try {
      const attrs: Record<string, string> = { protocol: form.mqtt_protocol };
      if (form.ble_address.trim()) attrs.ble_address = form.ble_address.trim();

      const payload = {
        name: form.name.trim(),
        type: form.type,
        room_id: Number(form.room_id),
        mqtt_topic: form.mqtt_topic.trim() || null,
        active: form.active,
        attributes: attrs,
      };

      if (editing) {
        const updated = await api.updateDevice(editing.id, payload);
        setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      } else {
        const created = await api.createDevice(payload);
        setDevices((prev) => [...prev, created]);
      }
      setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '' });
    } catch {
      setDeviceDialog((s) => ({ ...s, saving: false, error: 'Speichern fehlgeschlagen.' }));
    }
  };

  // ── Gerät löschen ──────────────────────────────────────────────────────────
  const deleteDevice = async (id: number) => {
    await api.deleteDevice(id);
    setDevices((prev) => prev.filter((d) => d.id !== id));
    setDeleteConfirm(null);
  };

  // ── Raum speichern ─────────────────────────────────────────────────────────
  const saveRoom = async () => {
    const { name, icon, editing } = roomDialog;
    if (!name.trim()) {
      setRoomDialog((s) => ({ ...s, error: 'Name ist erforderlich.' }));
      return;
    }
    setRoomDialog((s) => ({ ...s, saving: true, error: '' }));
    try {
      const payload = { name: name.trim(), icon };
      if (editing) {
        const updated = await api.updateRoom(editing.id, payload);
        setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      } else {
        const created = await api.createRoom(payload);
        setRooms((prev) => [...prev, created]);
      }
      setRoomDialog({ open: false, editing: undefined, name: '', icon: '🏠', saving: false, error: '' });
    } catch {
      setRoomDialog((s) => ({ ...s, saving: false, error: 'Speichern fehlgeschlagen.' }));
    }
  };

  // ── Raum löschen ───────────────────────────────────────────────────────────
  const deleteRoom = async (id: number) => {
    await api.deleteRoom(id);
    setRooms((prev) => prev.filter((r) => r.id !== id));
    setDevices((prev) => prev.filter((d) => d.room_id !== id));
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-10 max-w-3xl">
      <h1 className="text-2xl font-bold">Einstellungen</h1>

      {/* ── Geräte ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Geräte</h2>
          <Button
            size="sm"
            onClick={() =>
              setDeviceDialog({ open: true, form: emptyDevice(), saving: false, error: '' })
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Neues Gerät
          </Button>
        </div>

        <div className="space-y-2">
          {devices.length === 0 && (
            <p className="text-muted-foreground text-sm">Noch keine Geräte vorhanden.</p>
          )}
          {devices.map((device) => {
            const room = rooms.find((r) => r.id === device.room_id);
            return (
              <Card key={device.id}>
                <CardContent className="flex items-center justify-between py-3 px-4">
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm">{device.name}</p>
                    <div className="flex gap-2 items-center flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {deviceLabels[device.type] ?? device.type}
                      </Badge>
                      {room && (
                        <span className="text-xs text-muted-foreground">{room.name}</span>
                      )}
                      {device.mqtt_topic && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Wifi className="h-3 w-3" />
                          {device.mqtt_topic}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDeviceDialog({
                          open: true,
                          editing: device,
                          form: deviceToForm(device),
                          saving: false,
                          error: '',
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        setDeleteConfirm({
                          open: true,
                          type: 'device',
                          id: device.id,
                          label: device.name,
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* ── Räume ───────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Räume</h2>
          <Button
            size="sm"
            onClick={() =>
              setRoomDialog({ open: true, editing: undefined, name: '', icon: '🏠', saving: false, error: '' })
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Neuer Raum
          </Button>
        </div>

        <div className="space-y-2">
          {rooms.length === 0 && (
            <p className="text-muted-foreground text-sm">Noch keine Räume vorhanden.</p>
          )}
          {rooms.map((room) => {
            const count = devices.filter((d) => d.room_id === room.id).length;
            return (
              <Card key={room.id}>
                <CardContent className="flex items-center justify-between py-3 px-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{room.icon}</span>
                    <div>
                      <p className="font-medium text-sm">{room.name}</p>
                      <p className="text-xs text-muted-foreground">{count} Gerät{count !== 1 ? 'e' : ''}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setRoomDialog({
                          open: true,
                          editing: room,
                          name: room.name,
                          icon: room.icon ?? '🏠',
                          saving: false,
                          error: '',
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        setDeleteConfirm({
                          open: true,
                          type: 'room',
                          id: room.id,
                          label: room.name,
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── Gerät-Dialog ────────────────────────────────────────────────── */}
      <Dialog
        open={deviceDialog.open}
        onOpenChange={(open) => !open && setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '' })}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deviceDialog.editing ? 'Gerät bearbeiten' : 'Neues Gerät hinzufügen'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Input
              label="Name"
              value={deviceDialog.form.name}
              onChange={(v) => setDeviceDialog((s) => ({ ...s, form: { ...s.form, name: v } }))}
              placeholder="z.B. Deckenlampe"
            />

            <div className="space-y-1">
              <label className="text-sm font-medium">Typ</label>
              <Select
                value={deviceDialog.form.type}
                onValueChange={(v) =>
                  setDeviceDialog((s) => ({ ...s, form: { ...s.form, type: v as DeviceType } }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEVICE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {deviceLabels[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Raum</label>
              <Select
                value={deviceDialog.form.room_id}
                onValueChange={(v) =>
                  setDeviceDialog((s) => ({ ...s, form: { ...s.form, room_id: v } }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Raum wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.icon} {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Protokoll</label>
              <Select
                value={deviceDialog.form.mqtt_protocol}
                onValueChange={(v) =>
                  setDeviceDialog((s) => ({ ...s, form: { ...s.form, mqtt_protocol: v as DeviceProtocol } }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PROTOCOLS.find((p) => p.value === deviceDialog.form.mqtt_protocol)?.hint}
              </p>
            </div>

            {/* MQTT Topic — für alle außer BLE und HTTP */}
            {deviceDialog.form.mqtt_protocol !== 'bluetooth_shelly_gen3' &&
             deviceDialog.form.mqtt_protocol !== 'shelly_gen3_http' && (
              <Input
                label="MQTT Topic (Basis)"
                value={deviceDialog.form.mqtt_topic}
                onChange={(v) =>
                  setDeviceDialog((s) => ({ ...s, form: { ...s.form, mqtt_topic: v } }))
                }
                placeholder={
                  deviceDialog.form.mqtt_protocol === 'shelly_gen3'
                    ? 'shellygen3/shellyplugsg3-XXXXXX'
                    : deviceDialog.form.mqtt_protocol === 'shelly_gen1'
                    ? 'shellies/shellyplug-s-XXXXXX'
                    : 'home/wohnzimmer/lampe'
                }
                hint="Tipp: Die Geräte-ID steht in der Shelly App unter Einstellungen → Geräteinformationen."
              />
            )}

            {/* IP-Adresse — nur für shelly_gen3_http */}
            {deviceDialog.form.mqtt_protocol === 'shelly_gen3_http' && (
              <Input
                label="IP-Adresse des Shelly"
                value={deviceDialog.form.mqtt_topic}
                onChange={(v) =>
                  setDeviceDialog((s) => ({ ...s, form: { ...s.form, mqtt_topic: v } }))
                }
                placeholder="192.168.1.42"
                hint="IP-Adresse aus der Shelly-App. Das Backend sendet HTTP direkt an das Gerät — ideal für den Raspberry Pi."
              />
            )}

            {/* BLE-Adresse — nur für bluetooth_shelly_gen3 */}
            {deviceDialog.form.mqtt_protocol === 'bluetooth_shelly_gen3' && (
              <>
                <Input
                  label="Bluetooth-Adresse (MAC)"
                  value={deviceDialog.form.ble_address}
                  onChange={(v) =>
                    setDeviceDialog((s) => ({ ...s, form: { ...s.form, ble_address: v } }))
                  }
                  placeholder="AA:BB:CC:DD:EE:FF"
                  hint="Für Browser-BLE: leer lassen (Gerät wird per Dialog ausgewählt). Für Raspberry Pi BLE Bridge: MAC-Adresse aus der Shelly-App eintragen."
                />
                <div className="rounded-md bg-muted px-4 py-3 text-sm space-y-1">
                  <p className="font-medium flex items-center gap-1.5">
                    🔵 Bluetooth-Modus aktiv
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Browser: Verbindung direkt im Dashboard herstellen (Chrome/Edge).
                    Raspberry Pi: BLE Bridge Daemon übernimmt automatisch.
                  </p>
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium flex-1">Aktiv</label>
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={deviceDialog.form.active}
                onChange={(e) =>
                  setDeviceDialog((s) => ({ ...s, form: { ...s.form, active: e.target.checked } }))
                }
              />
            </div>

            {deviceDialog.error && (
              <p className="text-sm text-destructive">{deviceDialog.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeviceDialog({ open: false, form: emptyDevice(), saving: false, error: '' })}
            >
              Abbrechen
            </Button>
            <Button onClick={saveDevice} disabled={deviceDialog.saving}>
              {deviceDialog.saving ? 'Speichern…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Raum-Dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={roomDialog.open}
        onOpenChange={(open) =>
          !open &&
          setRoomDialog({ open: false, editing: undefined, name: '', icon: '🏠', saving: false, error: '' })
        }
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{roomDialog.editing ? 'Raum bearbeiten' : 'Neuer Raum'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Input
              label="Name"
              value={roomDialog.name}
              onChange={(v) => setRoomDialog((s) => ({ ...s, name: v }))}
              placeholder="z.B. Wohnzimmer"
            />

            <div className="space-y-1">
              <label className="text-sm font-medium">Icon</label>
              <div className="flex gap-2 flex-wrap">
                {ROOM_ICONS.map((icon) => (
                  <button
                    key={icon}
                    onClick={() => setRoomDialog((s) => ({ ...s, icon }))}
                    className={`text-xl p-1.5 rounded-md border-2 transition-colors ${
                      roomDialog.icon === icon
                        ? 'border-primary bg-accent'
                        : 'border-transparent hover:border-muted'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {roomDialog.error && (
              <p className="text-sm text-destructive">{roomDialog.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setRoomDialog({ open: false, editing: undefined, name: '', icon: '🏠', saving: false, error: '' })
              }
            >
              Abbrechen
            </Button>
            <Button onClick={saveRoom} disabled={roomDialog.saving}>
              {roomDialog.saving ? 'Speichern…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Löschen bestätigen ──────────────────────────────────────────── */}
      <Dialog
        open={!!deleteConfirm?.open}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Wirklich löschen?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            <span className="font-medium text-foreground">{deleteConfirm?.label}</span> wird dauerhaft gelöscht.
            {deleteConfirm?.type === 'room' && (
              <> Alle Geräte in diesem Raum werden ebenfalls entfernt.</>
            )}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteConfirm) return;
                if (deleteConfirm.type === 'device') deleteDevice(deleteConfirm.id);
                else deleteRoom(deleteConfirm.id);
              }}
            >
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
