'use client';
import { useEffect, useState } from 'react';

export const DASHBOARD_LAYOUT_KEY = 'smarthome_dashboard_layout';
const FAVORITES_KEY = 'smarthome_favorites';
const LEGACY_WIDGETS_KEY = 'smarthome_dashboard_widgets';

export type BuiltInSectionId = 'scenes' | 'rooms';
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

const DEFAULT: DashboardLayout = {
  roomOrder: [],
  sectionOrder: ['scenes', 'rooms', `field:${DEFAULT_FIELD_ID}`],
  hiddenSections: [],
  fields: [{ id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds: [] }],
};

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

function migrateLegacy(parsed: Partial<DashboardLayout> & { sectionOrder?: string[] }): DashboardLayout {
  let fields: DashboardField[] = Array.isArray(parsed.fields) ? parsed.fields : [];
  let sectionOrder = (parsed.sectionOrder ?? DEFAULT.sectionOrder).slice() as string[];
  const hiddenSections = (parsed.hiddenSections ?? []).slice() as string[];
  const roomOrder = parsed.roomOrder ?? [];

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
    if (s === 'scenes' || s === 'rooms') return true;
    if (s.startsWith('field:')) return validFieldIds.has(s.slice(6));
    return false;
  }) as SectionId[];

  for (const field of fields) {
    const sid = `field:${field.id}` as SectionId;
    if (!sectionOrder.includes(sid)) sectionOrder.push(sid);
  }

  const hidden = hiddenSections
    .map(s => s === 'quickaccess' ? `field:${fields[0]?.id ?? DEFAULT_FIELD_ID}` : s)
    .filter(s => {
      if (s === 'scenes' || s === 'rooms') return true;
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

function load(): DashboardLayout {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<DashboardLayout> & { sectionOrder?: string[] };
    return migrateLegacy(p);
  } catch { return DEFAULT; }
}

export function loadDashboardLayout(): DashboardLayout {
  return load();
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

export function createFieldId(): string {
  return crypto.randomUUID();
}

export function fieldSectionId(fieldId: string): SectionId {
  return `field:${fieldId}`;
}

export function parseFieldSectionId(sectionId: SectionId): string | null {
  return sectionId.startsWith('field:') ? sectionId.slice(6) : null;
}

export function sectionLabel(sectionId: SectionId, fields: DashboardField[]): string {
  if (sectionId === 'scenes') return 'Szenen';
  if (sectionId === 'rooms') return 'Räume';
  const fieldId = parseFieldSectionId(sectionId);
  if (fieldId) return fields.find(f => f.id === fieldId)?.name ?? 'Geräte-Feld';
  return sectionId;
}
