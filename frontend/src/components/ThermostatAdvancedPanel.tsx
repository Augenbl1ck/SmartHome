'use client';

import { useState } from 'react';
import { api, Device } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loader2, Flame, Timer } from 'lucide-react';

const BOOST_DURATIONS = [15, 30, 60, 90, 180] as const;
const TIMER_DURATIONS = [30, 60, 120, 240] as const;

interface Props {
  device: Device;
  disabled?: boolean;
  onUpdated: (device: Device) => void;
}

export default function ThermostatAdvancedPanel({ device, disabled, onUpdated }: Props) {
  const attrs = device.attributes ?? {};
  const tempActive = Number(attrs.temporary_mode_duration ?? 0) > 0;
  const tempMode = String(attrs.temporary_mode_select ?? '');
  const tempMins = Number(attrs.temporary_mode_duration ?? 0);
  const timerTarget = Number(attrs.timer_mode_target_temp ?? 21);

  const [boostDuration, setBoostDuration] = useState(30);
  const [timerDuration, setTimerDuration] = useState(60);
  const [timerTemp, setTimerTemp] = useState(21);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-4 pt-1 border-t border-border/60">
      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
      )}

      {tempActive && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-orange-500/10 px-3 py-2.5">
          <p className="text-sm">
            {tempMode === 'timer' ? 'Timer' : 'Boost'} aktiv:{' '}
            <span className="font-semibold tabular-nums">{tempMins} Min.</span>
            {tempMode === 'timer' && Number.isFinite(timerTarget) && (
              <span className="ml-1 text-muted-foreground">({timerTarget.toFixed(1)}°C)</span>
            )}
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
      )}

      {!tempActive && (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame className="h-3 w-3" />
              Boost — voll heizen
            </div>
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
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Timer className="h-3 w-3" />
              Timer — eigene Zieltemperatur
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 flex-wrap">
                {TIMER_DURATIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTimerDuration(m)}
                    className={cn(
                      'cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                      timerDuration === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent',
                    )}
                  >
                    {m >= 60 ? `${m / 60} Std` : `${m} Min`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={4}
                  max={35}
                  step={0.5}
                  value={timerTemp}
                  disabled={disabled}
                  onChange={(e) => setTimerTemp(Number(e.target.value))}
                  className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
                  aria-label="Timer-Zieltemperatur"
                />
                <span className="text-xs text-muted-foreground">°C</span>
              </div>
              <button
                type="button"
                disabled={!!busy || disabled}
                onClick={() => run('timer', { command: 'timer', duration: timerDuration, temperature: timerTemp })}
                className="cursor-pointer rounded-xl bg-muted px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
              >
                {busy === 'timer' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Timer starten'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
