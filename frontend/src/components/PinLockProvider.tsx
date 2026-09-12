'use client';

/**
 * Globaler PinLock-Provider.
 * Stellt PinLockContext bereit und rendert den Lock-Screen wenn nötig.
 * Exportiert usePinLockContext für Komponenten die lock/unlock aufrufen wollen.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { usePinLock, PinLockState } from '@/hooks/usePinLock';
import PinLockScreen from '@/components/PinLockScreen';

const PinLockContext = createContext<PinLockState | null>(null);

export function usePinLockContext(): PinLockState {
  const ctx = useContext(PinLockContext);
  if (!ctx) throw new Error('usePinLockContext must be used within PinLockProvider');
  return ctx;
}

export default function PinLockProvider({ children }: { children: React.ReactNode }) {
  const state = usePinLock();
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    setMounted(true);
    // Inline-Blocker entfernen sobald React übernimmt
    document.getElementById('pin-blocker')?.remove();
  }, []);

  useEffect(() => {
    if (!state.enabled && !state.screenOff && !state.displayPoweredOff) return;
    if (!state.locked && !state.screenOff && !state.displayPoweredOff) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
      active.blur();
    }
  }, [state.enabled, state.locked, state.screenOff, state.displayPoweredOff]);

  const showPin = mounted && state.enabled && state.locked;
  const showBlack = mounted && state.screenOff && !state.displayPoweredOff;

  return (
    <PinLockContext.Provider value={state}>
      {children}
      {showPin && (
        <PinLockScreen
          onUnlock={state.unlock}
          onWake={state.wakeScreen}
          isScreenOff={showBlack}
        />
      )}
      {!showPin && showBlack && (
        <PinLockScreen
          onUnlock={async () => true}
          onWake={state.wakeScreen}
          isScreenOff
        />
      )}
      {mounted && state.displayPoweredOff && (
        <div
          className="fixed inset-0 z-[101] bg-transparent"
          onPointerUp={() => state.wakeScreen()}
          aria-label="Display aus — tippen zum Einschalten"
        />
      )}
    </PinLockContext.Provider>
  );
}
