'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePinLockContext } from '@/components/PinLockProvider';
import KioskBar from '@/components/KioskBar';
import KioskScreensaver from '@/components/KioskScreensaver';

const KIOSK_KEY = 'smarthome_kiosk';

interface KioskCtxType {
  kioskMode: boolean;
  setKioskMode: (v: boolean) => void;
}

const KioskCtx = createContext<KioskCtxType>({ kioskMode: false, setKioskMode: () => {} });

export function useKiosk() { return useContext(KioskCtx); }

function urlWantsKiosk(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('kiosk') === '1') return true;
  const hash = (window.location.hash || '').replace(/^#/, '');
  return hash === 'kiosk' || hash.includes('kiosk=1');
}

export default function KioskProvider({ children }: { children: React.ReactNode }) {
  const [kioskMode, setKioskModeState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Early-Script in layout.tsx kann localStorage schon gesetzt haben
    const force = urlWantsKiosk() || localStorage.getItem(KIOSK_KEY) === 'true';
    if (urlWantsKiosk()) {
      localStorage.setItem(KIOSK_KEY, 'true');
    }
    if (force) setKioskModeState(true);
  }, []);

  const setKioskMode = (v: boolean) => {
    setKioskModeState(v);
    localStorage.setItem(KIOSK_KEY, String(v));
    document.body.classList.toggle('kiosk-active', v);
    document.body.style.overscrollBehavior = v ? 'none' : '';
  };

  useEffect(() => {
    if (kioskMode) {
      document.body.classList.add('kiosk-active');
      document.body.style.overscrollBehavior = 'none';
    }
    return () => {
      document.body.classList.remove('kiosk-active');
      document.body.style.overscrollBehavior = '';
    };
  }, [kioskMode]);

  useEffect(() => {
    if (!kioskMode) return;
    const prevent = () => window.history.pushState(null, '', window.location.href);
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', prevent);
    return () => window.removeEventListener('popstate', prevent);
  }, [kioskMode]);

  const pinLock = usePinLockContext();

  return (
    <KioskCtx.Provider value={{ kioskMode, setKioskMode }}>
      {children}
      {mounted && kioskMode && <KioskBar />}
      {mounted && kioskMode && !pinLock.locked && !pinLock.screenOff && <KioskScreensaver />}
    </KioskCtx.Provider>
  );
}
