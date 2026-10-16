'use client';

import { createContext, useContext, useEffect } from 'react';
import KioskBar from '@/components/KioskBar';

interface KioskCtxType {
  kioskMode: true;
}

const KioskCtx = createContext<KioskCtxType>({ kioskMode: true });

export function useKiosk() { return useContext(KioskCtx); }

export default function KioskProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add('kiosk-active');
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.classList.remove('kiosk-active');
      document.body.style.overscrollBehavior = '';
    };
  }, []);

  useEffect(() => {
    const prevent = () => window.history.pushState(null, '', window.location.href);
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', prevent);
    return () => window.removeEventListener('popstate', prevent);
  }, []);

  return (
    <KioskCtx.Provider value={{ kioskMode: true }}>
      {children}
      <KioskBar />
    </KioskCtx.Provider>
  );
}
