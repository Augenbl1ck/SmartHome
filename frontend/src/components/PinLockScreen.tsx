'use client';

import { useState } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onUnlock: (pin: string) => Promise<boolean>;
  onWake?: () => void;
  isScreenOff?: boolean;
}

const BUTTONS = ['1','2','3','4','5','6','7','8','9','','0','⌫'] as const;

export default function PinLockScreen({ onUnlock, onWake, isScreenOff }: Props) {
  const [pin,   setPin]   = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  // Bildschirm schlafen → Touch weckt
  if (isScreenOff) {
    return (
      <div
        className="fixed inset-0 z-[100] bg-black flex items-center justify-center cursor-pointer"
        onClick={onWake}
        onTouchStart={onWake}
      >
        <div className="text-center select-none">
          <p className="text-5xl mb-3">🏠</p>
          <p className="text-white/50 text-sm">Tippen zum Entsperren</p>
        </div>
      </div>
    );
  }

  const append = async (char: string) => {
    if (char === '⌫') {
      setPin((p) => p.slice(0, -1));
      setError(false);
      return;
    }
    const next = pin + char;
    setPin(next);

    if (next.length === 4) {
      const ok = await onUnlock(next);
      if (!ok) {
        setShake(true);
        setError(true);
        setTimeout(() => {
          setPin('');
          setShake(false);
          setError(false);
        }, 600);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex flex-col items-center justify-center gap-8 select-none">
      {/* Icon + Titel */}
      <div className="text-center">
        <p className="text-5xl mb-2">🏠</p>
        <p className="text-lg font-semibold">SmartHome</p>
        <p className="text-sm text-muted-foreground mt-1">PIN eingeben</p>
      </div>

      {/* PIN-Punkte */}
      <div className={cn('flex gap-4', shake && 'animate-shake')}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-4 w-4 rounded-full border-2 transition-all duration-150',
              pin.length > i
                ? error
                  ? 'bg-destructive border-destructive'
                  : 'bg-foreground border-foreground'
                : 'border-muted-foreground bg-transparent'
            )}
          />
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive -mt-4">Falscher PIN</p>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-64">
        {BUTTONS.map((btn, i) => {
          if (btn === '') return <div key={i} />;
          return (
            <button
              key={i}
              onClick={() => append(btn)}
              className={cn(
                'h-16 rounded-2xl text-xl font-semibold transition-all',
                'flex items-center justify-center cursor-pointer',
                'active:scale-90',
                btn === '⌫'
                  ? 'bg-muted text-muted-foreground hover:bg-accent'
                  : 'bg-muted hover:bg-accent text-foreground'
              )}
            >
              {btn === '⌫' ? <Delete className="h-5 w-5" /> : btn}
            </button>
          );
        })}
      </div>
    </div>
  );
}
