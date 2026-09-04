'use client';

import { useState } from 'react';
import { Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const PRESETS: { label: string; minutes: number }[] = [
  { label: '5 Min', minutes: 5 },
  { label: '15 Min', minutes: 15 },
  { label: '30 Min', minutes: 30 },
  { label: '1 Std', minutes: 60 },
  { label: '2 Std', minutes: 120 },
];

export function formatDelayMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
  }
  return minutes === 1 ? '1 Minute' : `${minutes} Minuten`;
}

interface Props {
  open: boolean;
  sceneName: string;
  onClose: () => void;
  onConfirm: (minutes: number) => void;
}

export default function SceneDelayDialog({ open, sceneName, onClose, onConfirm }: Props) {
  const [amount, setAmount] = useState('15');
  const [unit, setUnit] = useState<'min' | 'h'>('min');

  const resolvedMinutes = (): number | null => {
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    const minutes = unit === 'h' ? Math.round(n * 60) : Math.round(n);
    if (minutes < 1 || minutes > 1440) return null;
    return minutes;
  };

  const minutes = resolvedMinutes();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Ausführen in…
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{sceneName}</span> später starten.
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.minutes}
                type="button"
                onClick={() => {
                  if (p.minutes % 60 === 0) {
                    setUnit('h');
                    setAmount(String(p.minutes / 60));
                  } else {
                    setUnit('min');
                    setAmount(String(p.minutes));
                  }
                }}
                className={cn(
                  'cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  minutes === p.minutes
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border hover:bg-accent',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Zeit"
            />
            <div className="flex rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => setUnit('min')}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium',
                  unit === 'min' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                Min
              </button>
              <button
                type="button"
                onClick={() => setUnit('h')}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium',
                  unit === 'h' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                Std
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            type="button"
            disabled={minutes == null}
            onClick={() => {
              if (minutes == null) return;
              onConfirm(minutes);
            }}
          >
            Planen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
