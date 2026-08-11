'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

export const DASHBOARD_LAYOUT_KEY = 'smarthome_dashboard_layout';
const FAVORITES_KEY = 'smarthome_favorites';
const LEGACY_WIDGETS_KEY = 'smarthome_dashboard_widgets';
const LAYOUT_EVENT = 'smarthome-dashboard-layout';

export type BuiltInSectionId = 'weather' | 'calendar' | 'scenes' | 'rooms';
export type SectionId = BuiltInSectionId | `field:${string}`;

export interface DashboardField {
  id: string;
  name: string;
  deviceIds: number[];
}

export interface DashboardLayout {
  roomOrder: number[];
  sectionOrder: SectionId[];
  hiddenSections: SectionId[];
  fields: DashboardField[];
}

const DEFAULT_FIELD_ID = 'default-quickaccess';

const BUILTIN_SECTIONS: BuiltInSectionId[] = ['weather', 'calendar', 'scenes', 'rooms'];

const DEFAULT: DashboardLayout = {
  roomOrder: [],
  sectionOrder: ['weather', 'calendar', 'scenes', 'rooms', `field:${DEFAULT_FIELD_ID}`],
  hiddenSections: [],
  fields: [{ id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds: [] }],
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

function isBuiltin(s: string): s is BuiltInSectionId {
  return (BUILTIN_SECTIONS as string[]).includes(s);
}

function migrateLegacy(parsed: Partial<DashboardLayout> & { sectionOrder?: string[] }): DashboardLayout {
  let fields: DashboardField[] = Array.isArray(parsed.fields) ? parsed.fields as DashboardField[] : [];
  let sectionOrder = (parsed.sectionOrder ?? DEFAULT.sectionOrder).slice() as string[];
  const hiddenSections = (parsed.hiddenSections ?? []).slice() as string[];
  const roomOrder = Array.isArray(parsed.roomOrder) ? parsed.roomOrder as number[] : [];

  const hadQuickaccess = sectionOrder.includes('quickaccess');
  sectionOrder = sectionOrder.filter(s => s !== 'quickaccess');

  if (fields.length === 0) {
    const favIds = readJson<number[]>(FAVORITES_KEY) ?? [];
    const widgetIds = readJson<number[]>(LEGACY_WIDGETS_KEY) ?? [];
    const deviceIds = widgetIds.length > 0 ? widgetIds : favIds;

    fields = [{ id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds }];
    if (hadQuickaccess && !sectionOrder.some(s => s.startsWith('field:'))) {
      sectionOrder.push(`field:${DEFAULT_FIELD_ID}`);
    }
  }

  if (hadQuickaccess) {
    sectionOrder = sectionOrder.map(s =>
      s === 'quickaccess' ? `field:${fields[0]?.id ?? DEFAULT_FIELD_ID}` : s,
    );
  }

  const validFieldIds = new Set(fields.map(f => f.id));
  sectionOrder = sectionOrder.filter(s => {
    if (isBuiltin(s)) return true;
    if (s.startsWith('field:')) return validFieldIds.has(s.slice(6));
    return false;
  }) as SectionId[];

  for (const builtin of ['weather', 'calendar'] as const) {
    if (!sectionOrder.includes(builtin)) {
      sectionOrder.unshift(builtin);
    }
  }

  for (const field of fields) {
    const sid = `field:${field.id}` as SectionId;
    if (!sectionOrder.includes(sid)) sectionOrder.push(sid);
  }

  const hidden = hiddenSections
    .map(s => s === 'quickaccess' ? `field:${fields[0]?.id ?? DEFAULT_FIELD_ID}` : s)
    .filter(s => {
      if (isBuiltin(s)) return true;
      if (s.startsWith('field:')) return validFieldIds.has(s.slice(6));
      return false;
    }) as SectionId[];

  return {
    roomOrder,
    sectionOrder: sectionOrder.length > 0 ? sectionOrder as SectionId[] : DEFAULT.sectionOrder,
    hiddenSections: hidden,
    fields,
  };
}

function cacheLocal(layout: DashboardLayout): void {
  try {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
  } catch { /* */ }
  window.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
  window.dispatchEvent(new StorageEvent('storage', { key: DASHBOARD_LAYOUT_KEY }));
}

function loadLocal(): DashboardLayout {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<DashboardLayout> & { sectionOrder?: string[] };
    return migrateLegacy(p);
  } catch { return DEFAULT; }
}

function isMeaningful(layout: DashboardLayout): boolean {
  if (layout.fields.some(f => f.deviceIds.length > 0)) return true;
  if (layout.hiddenSections.length > 0) return true;
  if (layout.roomOrder.length > 0) return true;
  const defOrder = DEFAULT.sectionOrder.join(',');
  if (layout.sectionOrder.join(',') !== defOrder) return true;
  if (layout.fields.length !== 1) return true;
  if (layout.fields[0]?.name !== 'Schnellzugriff') return true;
  return false;
}

export function loadDashboardLayout(): DashboardLayout {
  return loadLocal();
}

export function useDashboardLayout(): DashboardLayout {
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT);

  useEffect(() => {
    let cancelled = false;

    const apply = (next: DashboardLayout) => {
      if (cancelled) return;
      cacheLocal(next);
      setLayout(next);
    };

    (async () => {
      const local = loadLocal();
      setLayout(local);

      try {
        const s = await api.getPanelSettings();
        if (cancelled) return;

        if (s.dashboard_layout && typeof s.dashboard_layout === 'object') {
          apply(migrateLegacy(s.dashboard_layout as Partial<DashboardLayout>));
          return;
        }

        // One-shot migrate local → server
        if (isMeaningful(local)) {
          await api.updatePanelSettings({ dashboard_layout: local });
        }
      } catch {
        /* API down — local cache */
      }
    })();

    const onChange = () => setLayout(loadLocal());
    window.addEventListener(LAYOUT_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(LAYOUT_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return layout;
}

/** Optimistic local write + persist to server (shared across all panels). */
export async function saveDashboardLayout(layout: DashboardLayout): Promise<void> {
  const normalized = migrateLegacy(layout);
  cacheLocal(normalized);
  try {
    await api.updatePanelSettings({ dashboard_layout: normalized });
  } catch {
    /* keep local cache if API fails */
  }
}

export function createFieldId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function fieldSectionId(fieldId: string): SectionId {
  return `field:${fieldId}`;
}

export function parseFieldSectionId(sectionId: SectionId): string | null {
  return sectionId.startsWith('field:') ? sectionId.slice(6) : null;
}

export function sectionLabel(sectionId: SectionId, fields: DashboardField[]): string {
  if (sectionId === 'weather') return 'Wetter';
  if (sectionId === 'calendar') return 'Kalender';
  if (sectionId === 'scenes') return 'Szenen';
  if (sectionId === 'rooms') return 'Räume';
  const fieldId = parseFieldSectionId(sectionId);
  if (fieldId) return fields.find(f => f.id === fieldId)?.name ?? 'Geräte-Feld';
  return sectionId;
}

export function useDashboardLayoutState(): [DashboardLayout, (next: DashboardLayout) => void] {
  const layout = useDashboardLayout();
  const [, bump] = useState(0);
  const save = useCallback((next: DashboardLayout) => {
    void saveDashboardLayout(next).then(() => bump(n => n + 1));
  }, []);
  return [layout, save];
}
