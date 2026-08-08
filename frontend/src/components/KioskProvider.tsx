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

export default function KioskProvider({ children }: { children: React.ReactNode }) {
  const [kioskMode, setKioskModeState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (localStorage.getItem(KIOSK_KEY) === 'true') setKioskModeState(true);
  }, []);

  const setKioskMode = (v: boolean) => {
    setKioskModeState(v);
    localStorage.setItem(KIOSK_KEY, String(v));
    // body-Klasse für CSS-Padding-Adjustierung
    document.body.classList.toggle('kiosk-active', v);
    // Overscroll verhindern
    document.body.style.overscrollBehavior = v ? 'none' : '';
  };

  // Body-Klasse beim Mount setzen (verhindert Flash)
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

  // Browser-Zurück-Taste im Kiosk-Modus deaktivieren
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
