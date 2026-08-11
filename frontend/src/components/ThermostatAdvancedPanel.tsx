'use client';

import { useState } from 'react';
import { api, Device } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loader2, Flame } from 'lucide-react';

const BOOST_DURATIONS = [15, 30, 60, 90, 180] as const;

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
    </div>
  );
}
