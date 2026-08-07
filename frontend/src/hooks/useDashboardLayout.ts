'use client';
import { useEffect, useState } from 'react';

export const DASHBOARD_LAYOUT_KEY = 'smarthome_dashboard_layout';

export type SectionId = 'scenes' | 'rooms' | 'quickaccess';

export interface DashboardLayout {
  roomOrder: number[];
  sectionOrder: SectionId[];
  hiddenSections: SectionId[];
}

const DEFAULT: DashboardLayout = {
  roomOrder: [],
  sectionOrder: ['scenes', 'rooms', 'quickaccess'],
  hiddenSections: [],
};

function load(): DashboardLayout {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<DashboardLayout>;
    return { ...DEFAULT, ...p };
  } catch { return DEFAULT; }
}

export function useDashboardLayout(): DashboardLayout {
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT);

  useEffect(() => {
    setLayout(load());
    const handler = (e: StorageEvent) => {
      if (e.key === DASHBOARD_LAYOUT_KEY) setLayout(load());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return layout;
}

export function saveDashboardLayout(layout: DashboardLayout): void {
  localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
  window.dispatchEvent(new StorageEvent('storage', { key: DASHBOARD_LAYOUT_KEY }));
}
