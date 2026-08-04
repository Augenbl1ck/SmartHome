'use client';

import { useState } from 'react';
import { api, Device } from '@/lib/api';
import { isToggleable } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { PowerOff, Loader2 } from 'lucide-react';
import { emitDeviceUpdate } from '@/lib/device-events';
import { cn } from '@/lib/utils';

interface Props { devices: Device[] }

export default function DashboardActions({ devices }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const turnAllOff = async () => {
    const active = devices.filter(
      d => d.status === 'on' && isToggleable(d.type as DeviceType)
    );
    if (active.length === 0) return;

    setLoading(true);
    await Promise.allSettled(
      active.map(d =>
        api.setDeviceStatus(d.id, 'off')
          .then(() => emitDeviceUpdate(d.id, 'off'))
          .catch(() => {})
      )
    );
    setLoading(false);
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  };

  const activeCount = devices.filter(
    d => d.status === 'on' && isToggleable(d.type as DeviceType)
  ).length;

  if (activeCount === 0 && !done && !loading) {
    // Immer sichtbar, nur deaktiviert
  }

  return (
    <button
      onClick={turnAllOff}
      disabled={loading || activeCount === 0}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.97]',
        'disabled:cursor-not-allowed',
        activeCount > 0 || done
          ? 'border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10'
          : 'border-border bg-muted text-muted-foreground opacity-50'
      )}
    >
      {loading
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <PowerOff className="h-4 w-4" />}
      {done
        ? '✓ Alle aus'
        : loading
        ? 'Schalte…'
        : activeCount > 0
        ? `Alle aus (${activeCount})`
        : 'Alle aus'}
    </button>
  );
}
