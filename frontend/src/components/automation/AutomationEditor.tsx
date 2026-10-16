'use client';

import { useState } from 'react';
import { ChevronRight, Filter, Plus, Shield } from 'lucide-react';
import { Device, Room, Scene } from '@/lib/api';
import {
  ActionFormItem, ActionType, ConditionFormItem, ConditionLogic, ConditionType, FormState,
  actionIsComplete, actionOfType, buildAction, buildConditions,
  conditionOfType, describeAction, describeConditions,
} from '@/lib/automation-form';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import BlockPicker, { choicesFor, LOCK_CHOICES } from '@/components/automation/BlockPicker';
import LockCard from '@/components/automation/LockCard';
import ConditionCard from '@/components/automation/ConditionCard';
import ActionCard from '@/components/automation/ActionCard';
import { FieldLabel, TextInput } from '@/components/automation/fields';

type Picker =
  | { kind: 'condition' }
  | { kind: 'action' }
  | { kind: 'lock' }
  | null;

function moveItem<T extends { id: string }>(items: T[], id: string, dir: -1 | 1): T[] {
  const i = items.findIndex((item) => item.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = items.slice();
  const [row] = next.splice(i, 1);
  next.splice(j, 0, row);
  return next;
}

export default function AutomationEditor({
  title, form, devices, rooms, scenes, saving, error,
  onChange, onClose, onSave,
}: {
  title: string;
  form: FormState;
  devices: Device[];
  rooms: Room[];
  scenes: Scene[];
  saving: boolean;
  error: string;
  onChange: (patch: Partial<FormState>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [picker, setPicker] = useState<Picker>(null);
  const [lockChosen, setLockChosen] = useState(Boolean(form.blockDeviceId));
  const patchCond = (id: string, patch: Partial<ConditionFormItem>) => {
    onChange({ conditions: form.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };
  const patchAction = (id: string, patch: Partial<ActionFormItem>) => {
    onChange({ actions: form.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  };

  const condText = describeConditions(buildConditions(form), devices);
  const previewAction = form.kind === 'lock'
    ? describeAction({ type: 'block_command', device_id: Number(form.blockDeviceId), status: form.blockStatus }, devices, rooms, scenes)
    : describeAction(buildAction(form), devices, rooms, scenes);
  const showPreview = !!condText && (form.kind === 'lock'
    ? !!form.blockDeviceId
    : form.actions.length > 0 && form.actions.every(actionIsComplete));

  return (
    <div className="space-y-5 max-w-3xl xl:max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button type="button" onClick={onSave} disabled={saving}>{saving ? 'Speichern…' : 'Speichern'}</Button>
        </div>
      </div>

      <div className="space-y-1 max-w-lg">
        <FieldLabel>Name</FieldLabel>
        <TextInput
          value={form.name}
          onChange={(v) => onChange({ name: v })}
          placeholder={form.kind === 'lock' ? 'z.B. PC schützt Steckdose' : 'z.B. Nachtmodus'}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold flex items-center gap-1.5"><Filter className="h-4 w-4" /> Wenn</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setPicker({ kind: 'condition' })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Bedingung
          </Button>
        </div>
        {form.conditions.length > 1 && (
          <div className="max-w-sm space-y-1">
            <FieldLabel>Verknüpfung</FieldLabel>
            <Select value={form.conditionLogic} onValueChange={(v) => onChange({ conditionLogic: v as ConditionLogic })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="and">Alle Bedingungen (und)</SelectItem>
                <SelectItem value="or">Eine Bedingung reicht (oder)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {picker?.kind === 'condition' && (
          <BlockPicker
            title="Bedingung hinzufügen"
            choices={choicesFor('condition')}
            onClose={() => setPicker(null)}
            onPick={(type) => {
              onChange({ conditions: [...form.conditions, conditionOfType(type as ConditionType)] });
              setPicker(null);
            }}
          />
        )}
        <div className="space-y-3">
          {form.conditions.map((cond, idx) => (
            <ConditionCard
              key={cond.id}
              cond={cond}
              index={idx}
              logic={form.conditionLogic}
              canRemove={form.conditions.length > 1}
              canMoveUp={idx > 0}
              canMoveDown={idx < form.conditions.length - 1}
              devices={devices}
              rooms={rooms}
              onChange={(patch) => patchCond(cond.id, patch)}
              onRemove={() => onChange({ conditions: form.conditions.filter((c) => c.id !== cond.id) })}
              onMove={(dir) => onChange({ conditions: moveItem(form.conditions, cond.id, dir) })}
            />
          ))}
        </div>
      </section>

      {form.kind === 'lock' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><Shield className="h-4 w-4" /> Dann darf nicht</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setPicker({ kind: 'lock' })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Befehl
            </Button>
          </div>
          {picker?.kind === 'lock' && (
            <BlockPicker
              title="Verbotenen Befehl wählen"
              choices={LOCK_CHOICES}
              onClose={() => setPicker(null)}
              onPick={(type) => {
                onChange({ blockStatus: type, blockDeviceId: '' });
                setLockChosen(true);
                setPicker(null);
              }}
            />
          )}
          {lockChosen && (
            <LockCard form={form} devices={devices} rooms={rooms} onChange={onChange} />
          )}
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><ChevronRight className="h-4 w-4" /> Dann</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setPicker({ kind: 'action' })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Aktion
            </Button>
          </div>
          {picker?.kind === 'action' && (
            <BlockPicker
              title="Aktion hinzufügen"
              choices={choicesFor('action')}
              onClose={() => setPicker(null)}
              onPick={(type) => {
                onChange({ actions: [...form.actions, actionOfType(type as ActionType)] });
                setPicker(null);
              }}
            />
          )}
          <div className="space-y-3">
            {form.actions.map((action, idx) => (
              <ActionCard
                key={action.id}
                action={action}
                canRemove={form.actions.length > 1}
                canMoveUp={idx > 0}
                canMoveDown={idx < form.actions.length - 1}
                devices={devices}
                rooms={rooms}
                scenes={scenes}
                onChange={(patch) => patchAction(action.id, patch)}
                onRemove={() => onChange({ actions: form.actions.filter((a) => a.id !== action.id) })}
                onMove={(dir) => onChange({ actions: moveItem(form.actions, action.id, dir) })}
              />
            ))}
          </div>
          <div className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-4">
            <div className="space-y-0.5 pr-2">
              <p className="text-sm font-medium">Bei Sperre erneut versuchen</p>
              <p className="text-xs text-muted-foreground">
                Wenn eine Sperre die Aktion verhindert, alle 5 Minuten neu versuchen, höchstens 24 Stunden.
              </p>
            </div>
            <Switch checked={form.retryIfBlocked} onCheckedChange={(v) => onChange({ retryIfBlocked: v })} />
          </div>
        </section>
      )}

      {showPreview && (
        <div className="rounded-2xl bg-muted px-4 py-3 text-sm space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vorschau</p>
          <p><span className="text-muted-foreground">Wenn: </span>{condText}</p>
          <p><span className="text-muted-foreground">{form.kind === 'lock' ? 'Dann darf nicht: ' : 'Dann: '}</span>
            <span className="font-medium">{previewAction}</span>
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
