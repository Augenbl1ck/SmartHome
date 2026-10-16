'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Shell = 'phone' | 'panel' | 'desk';

interface KioskCtxType {
  /** Dichteres Layout auf Handy und 10-Zoll-Panel. */
  kioskMode: boolean;
  /** Pi-Autostart: Zurück-Navigation gesperrt. */
  kioskLock: boolean;
  shell: Shell;
}

const KioskCtx = createContext<KioskCtxType>({
  kioskMode: true,
  kioskLock: false,
  shell: 'panel',
});

export function useKiosk() { return useContext(KioskCtx); }

function readShell(): Shell {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 768) return 'phone';
  if (w >= 1440 || (w >= 1280 && h >= 900)) return 'desk';
  return 'panel';
}

function readKioskLock(): boolean {
  try {
    return localStorage.getItem('smarthome_kiosk') === 'true';
  } catch {
    return false;
  }
}

export default function KioskProvider({ children }: { children: ReactNode }) {
  const [shell, setShell] = useState<Shell>('panel');
  const [kioskLock, setKioskLock] = useState(false);

  useEffect(() => {
    const apply = () => setShell(readShell());
    apply();
    setKioskLock(readKioskLock());
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('kiosk-active', kioskLock);
    if (kioskLock) document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.classList.remove('kiosk-active');
      document.body.style.overscrollBehavior = '';
    };
  }, [kioskLock]);

  useEffect(() => {
    if (!kioskLock) return;
    const prevent = () => window.history.pushState(null, '', window.location.href);
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', prevent);
    return () => window.removeEventListener('popstate', prevent);
  }, [kioskLock]);

  return (
    <KioskCtx.Provider value={{ kioskMode: shell !== 'desk', kioskLock, shell }}>
      {children}
    </KioskCtx.Provider>
  );
}
