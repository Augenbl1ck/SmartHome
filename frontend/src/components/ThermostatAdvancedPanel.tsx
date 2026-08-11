'use client';

import { useState } from 'react';
import { api, Device } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loader2, Flame, CalendarDays, Gauge } from 'lucide-react';

const BOOST_DURATIONS = [15, 30, 60, 90, 180] as const;

const SCHEDULE_DAYS: { key: string; label: string }[] = [
  { key: 'monday', label: 'Mo' },
  { key: 'tuesday', label: 'Di' },
  { key: 'wednesday', label: 'Mi' },
  { key: 'thursday', label: 'Do' },
  { key: 'friday', label: 'Fr' },
  { key: 'saturday', label: 'Sa' },
  { key: 'sunday', label: 'So' },
];

type Transition = { time: string; temp: string };

function parseTransitions(raw: unknown): Transition[] {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [{ time: '00:00', temp: '17' }];
  }
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const parsed = parts.map((p) => {
    const [time, temp] = p.split('/');
    return { time: time || '00:00', temp: temp || '17' };
  });
  return parsed.length > 0 ? parsed.slice(0, 6) : [{ time: '00:00', temp: '17' }];
}

function formatTransitions(rows: Transition[]): string {
  return rows
    .filter((r) => r.time && r.temp !== '')
    .slice(0, 6)
    .map((r) => `${r.time}/${Number(r.temp)}`)
    .join(' ');
}

interface Props {
  device: Device;
  disabled?: boolean;
  onUpdated: (device: Device) => void;
}

export default function ThermostatAdvancedPanel({ device, disabled, onUpdated }: Props) {
  const attrs = device.attributes ?? {};
  const boostActive = Number(attrs.temporary_mode_duration ?? 0) > 0;
  const boostMode = String(attrs.temporary_mode_select ?? '');
  const boostMins = Number(attrs.temporary_mode_duration ?? 0);

  const [boostDuration, setBoostDuration] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scheduleDay, setScheduleDay] = useState('monday');
  const [transitions, setTransitions] = useState<Transition[]>(() =>
    parseTransitions(attrs[`weekly_schedule_${scheduleDay}`]),
  );

  const [opening, setOpening] = useState(Number(attrs.valve_opening_degree ?? 100));
  const [closing, setClosing] = useState(Number(attrs.valve_closing_degree ?? 100));

  const run = async (label: string, body: Record<string, unknown>) => {
    if (disabled || busy) return;
    setBusy(label);
    setError(null);
    try {
      const updated = await api.setThermostatCommand(device.id, body);
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(null);
    }
  };

  const loadDay = (day: string) => {
    setScheduleDay(day);
    setTransitions(parseTransitions(attrs[`weekly_schedule_${day}`]));
  };

  return (
    <div className="space-y-4 pt-1 border-t border-border/60">
      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
      )}

      {/* Boost */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Flame className="h-3 w-3" />
          Boost-Timer
        </div>
        {boostActive ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-orange-500/10 px-3 py-2.5">
            <p className="text-sm">
              Aktiv ({boostMode || 'boost'}): <span className="font-semibold tabular-nums">{boostMins} Min.</span>
            </p>
            <button
              type="button"
              disabled={!!busy || disabled}
              onClick={() => run('clear', { command: 'clear_boost' })}
              className="cursor-pointer text-xs font-medium text-destructive hover:underline disabled:opacity-40"
            >
              {busy === 'clear' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Abbrechen'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 flex-wrap">
              {BOOST_DURATIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setBoostDuration(m)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                    boostDuration === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent',
                  )}
                >
                  {m} Min
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!!busy || disabled}
              onClick={() => run('boost', { command: 'boost', duration: boostDuration })}
              className="cursor-pointer rounded-xl bg-orange-500/15 text-orange-700 dark:text-orange-300 px-3 py-2 text-sm font-medium hover:bg-orange-500/25 disabled:opacity-40"
            >
              {busy === 'boost' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Boost starten'}
            </button>
          </div>
        )}
      </div>

      {/* Wochenplan */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3 w-3" />
          Wochenplan
        </div>
        <div className="flex gap-1 flex-wrap">
          {SCHEDULE_DAYS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => loadDay(d.key)}
              className={cn(
                'cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                scheduleDay === d.key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {transitions.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={row.time}
                disabled={disabled}
                onChange={(e) => {
                  const next = [...transitions];
                  next[i] = { ...next[i], time: e.target.value };
                  setTransitions(next);
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm w-[7.5rem]"
              />
              <input
                type="number"
                step={0.5}
                min={4}
                max={35}
                value={row.temp}
                disabled={disabled}
                onChange={(e) => {
                  const next = [...transitions];
                  next[i] = { ...next[i], temp: e.target.value };
                  setTransitions(next);
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm w-20 tabular-nums"
              />
              <span className="text-xs text-muted-foreground">°C</span>
              {transitions.length > 1 && (
                <button
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setTransitions(transitions.filter((_, idx) => idx !== i))}
                >
                  Entfernen
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {transitions.length < 6 && (
            <button
              type="button"
              className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setTransitions([...transitions, { time: '12:00', temp: '21' }])}
            >
              + Übergang
            </button>
          )}
          <button
            type="button"
            disabled={!!busy || disabled}
            onClick={() =>
              run('schedule', {
                command: 'schedule_day',
                day: scheduleDay,
                transitions: formatTransitions(transitions),
              })
            }
            className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:opacity-40"
          >
            {busy === 'schedule' ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : 'Tag speichern'}
          </button>
          <button
            type="button"
            className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              const src = formatTransitions(transitions);
              // Lokal in Form belassen; Speichern bleibt pro Tag
              setTransitions(parseTransitions(src));
            }}
            title="Aktuelle Zeilen beibehalten (zum Kopieren auf anderen Tag wechseln und speichern)"
          >
            Zeilen behalten
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Bis 6 Übergänge, erster Eintrag sollte 00:00 sein. Für anderen Tag: Tag wählen, ggf. anpassen, speichern.
        </p>
      </div>

      {/* Ventil */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Gauge className="h-3 w-3" />
          Ventil-Kalibrierung
        </div>
        <p className="text-[10px] text-muted-foreground">
          Opening/Closing Degree (0–100). Falsche Werte können die Ventilfunktion beeinträchtigen.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/50 px-3 py-2.5 space-y-1">
            <p className="text-xs text-muted-foreground">Opening (%)</p>
            <input
              type="number"
              min={0}
              max={100}
              disabled={disabled}
              value={opening}
              onChange={(e) => setOpening(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2.5 space-y-1">
            <p className="text-xs text-muted-foreground">Closing (%)</p>
            <input
              type="number"
              min={0}
              max={100}
              disabled={disabled}
              value={closing}
              onChange={(e) => setClosing(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </div>
        </div>
        <button
          type="button"
          disabled={!!busy || disabled}
          onClick={() => run('valve', { command: 'valve', opening, closing })}
          className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:opacity-40"
        >
          {busy === 'valve' ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : 'Ventilwerte speichern'}
        </button>
        {(attrs.idle_steps != null || attrs.closing_steps != null) && (
          <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            {attrs.idle_steps != null && <span>Idle-Steps: {String(attrs.idle_steps)}</span>}
            {attrs.closing_steps != null && <span>Closing-Steps: {String(attrs.closing_steps)}</span>}
            {attrs.valve_motor_running_voltage != null && (
              <span>Motor: {String(attrs.valve_motor_running_voltage)} mV</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
