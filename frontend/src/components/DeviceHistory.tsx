'use client';

import { useEffect, useState } from 'react';
import { api, DeviceLog } from '@/lib/api';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props { deviceId: number; deviceName: string }

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  return `vor ${Math.floor(diff / 86400)} Tagen`;
}

export default function DeviceHistory({ deviceId, deviceName }: Props) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<DeviceLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || logs.length > 0) return;
    setLoading(true);
    api.getDeviceLogs(deviceId).then(data => {
      setLogs(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [open, deviceId, logs.length]);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Clock className="h-3 w-3" />
        Verlauf
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-1 max-h-36 overflow-y-auto pr-1">
          {loading && <p className="text-xs text-muted-foreground">Lädt…</p>}
          {!loading && logs.length === 0 && <p className="text-xs text-muted-foreground">Kein Verlauf vorhanden.</p>}
          {logs.map(log => (
            <div key={log.id} className="flex items-center justify-between gap-2">
              <span className={cn(
                'text-xs font-medium px-1.5 py-0.5 rounded',
                log.status === 'on' ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-muted text-muted-foreground'
              )}>
                {log.status === 'on' ? 'Ein' : log.status === 'off' ? 'Aus' : log.status}
              </span>
              <span className="text-xs text-muted-foreground">{formatRelative(log.recorded_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
