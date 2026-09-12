'use client';

import { useState } from 'react';
import { api, Device } from '@/lib/api';
import { isToggleable, commandBlocked } from '@/lib/devices';
import { DeviceType } from '@/lib/api';
import { PowerOff, Loader2 } from 'lucide-react';
import { emitDeviceUpdate } from '@/lib/device-events';
import { holdDeviceStatus } from '@/lib/device-status-hold';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props { devices: Device[] }

export default function DashboardActions({ devices }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const turnAllOff = async () => {
    const active = devices.filter(
      d => d.status === 'on' && isToggleable(d.type as DeviceType)
    );
    const free = active.filter(d => !commandBlocked(d, 'off'));
    const skipped = active.length - free.length;
    if (free.length === 0) {
      if (skipped > 0) toast.warning('Geräte durch Sperre geschützt — nichts ausgeschaltet.');
      return;
    }

    setLoading(true);
    await Promise.allSettled(
      free.map(d => {
        holdDeviceStatus(d.id, 'off');
        return api.setDeviceStatus(d.id, 'off')
          .then(() => emitDeviceUpdate(d.id, 'off'))
          .catch(() => {});
      })
    );
    setLoading(false);
    setDone(true);
    setTimeout(() => setDone(false), 3000);
    if (skipped > 0) toast.warning(`${skipped} Gerät${skipped === 1 ? '' : 'e'} wegen Sperre nicht ausgeschaltet.`);
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
