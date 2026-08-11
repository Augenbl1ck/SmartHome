'use client';

import { useCallback, useEffect, useState } from 'react';

export const DASHBOARD_LAYOUT_KEY = 'smarthome_dashboard_layout';
const FAVORITES_KEY = 'smarthome_favorites';
const LEGACY_WIDGETS_KEY = 'smarthome_dashboard_widgets';

export type WidgetKind = 'clock' | 'weather' | 'calendar' | 'scenes' | 'rooms' | 'field';

export interface DashboardField {
  id: string;
  name: string;
  deviceIds: number[];
}

export interface GridWidget {
  id: string;
  kind: WidgetKind;
  fieldId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardPage {
  id: string;
  name: string;
  widgets: GridWidget[];
}

export interface DashboardLayout {
  version: 2;
  cols: { sm: number; md: number };
  activePageId: string;
  pages: DashboardPage[];
  fields: DashboardField[];
  roomOrder: number[];
}

/** @deprecated v1 types kept for migration */
type BuiltInSectionId = 'weather' | 'calendar' | 'scenes' | 'rooms';
type SectionId = BuiltInSectionId | `field:${string}`;

const DEFAULT_FIELD_ID = 'default-quickaccess';
const HOME_PAGE_ID = 'page-home';

export const WIDGET_SIZE_LIMITS: Record<WidgetKind, { minW: number; minH: number; maxW: number; maxH: number }> = {
  clock: { minW: 2, minH: 1, maxW: 8, maxH: 3 },
  weather: { minW: 2, minH: 2, maxW: 4, maxH: 3 },
  calendar: { minW: 2, minH: 2, maxW: 4, maxH: 5 },
  scenes: { minW: 2, minH: 2, maxW: 8, maxH: 3 },
  rooms: { minW: 2, minH: 3, maxW: 8, maxH: 8 },
  field: { minW: 2, minH: 2, maxW: 8, maxH: 6 },
};

export function defaultWidgetsForPage(fields: DashboardField[]): GridWidget[] {
  const widgets: GridWidget[] = [
    { id: 'clock', kind: 'clock', x: 0, y: 0, w: 4, h: 2 },
    { id: 'weather', kind: 'weather', x: 0, y: 2, w: 2, h: 2 },
    { id: 'calendar', kind: 'calendar', x: 2, y: 2, w: 2, h: 3 },
    { id: 'scenes', kind: 'scenes', x: 0, y: 5, w: 4, h: 2 },
    { id: 'rooms', kind: 'rooms', x: 0, y: 7, w: 4, h: 4 },
  ];
  let y = 11;
  for (const f of fields) {
    widgets.push({
      id: `field:${f.id}`,
      kind: 'field',
      fieldId: f.id,
      x: 0,
      y,
      w: 4,
      h: 3,
    });
    y += 3;
  }
  return widgets;
}

function createDefaultLayout(): DashboardLayout {
  const fields: DashboardField[] = [
    { id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds: [] },
  ];
  const page: DashboardPage = {
    id: HOME_PAGE_ID,
    name: 'Home',
    widgets: defaultWidgetsForPage(fields),
  };
  return {
    version: 2,
    cols: { sm: 4, md: 8 },
    activePageId: HOME_PAGE_ID,
    pages: [page],
    fields,
    roomOrder: [],
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function migrateFromV1(parsed: Record<string, unknown>): DashboardLayout {
  const fieldsRaw = Array.isArray(parsed.fields) ? parsed.fields as DashboardField[] : [];
  let fields = fieldsRaw.length > 0
    ? fieldsRaw
    : [{ id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds: [] as number[] }];

  if (fields.length === 0 || (fields.length === 1 && fields[0].deviceIds.length === 0)) {
    const favIds = readJson<number[]>(FAVORITES_KEY) ?? [];
    const widgetIds = readJson<number[]>(LEGACY_WIDGETS_KEY) ?? [];
    const deviceIds = widgetIds.length > 0 ? widgetIds : favIds;
    if (deviceIds.length > 0) {
      fields = [{ id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds }];
    }
  }

  const sectionOrder = (Array.isArray(parsed.sectionOrder) ? parsed.sectionOrder : []) as string[];
  const hidden = new Set((Array.isArray(parsed.hiddenSections) ? parsed.hiddenSections : []) as string[]);

  const widgets: GridWidget[] = [];
  let y = 0;

  const place = (kind: WidgetKind, id: string, w: number, h: number, fieldId?: string) => {
    if (hidden.has(id) || (kind !== 'field' && hidden.has(kind))) return;
    widgets.push({ id, kind, fieldId, x: 0, y, w, h });
    y += h;
  };

  // Always include clock first
  place('clock', 'clock', 4, 2);

  const order = sectionOrder.length > 0
    ? sectionOrder
    : ['weather', 'calendar', 'scenes', 'rooms', ...fields.map(f => `field:${f.id}`)];

  for (const sid of order) {
    if (sid === 'weather') place('weather', 'weather', 2, 2);
    else if (sid === 'calendar') place('calendar', 'calendar', 2, 3);
    else if (sid === 'scenes') place('scenes', 'scenes', 4, 2);
    else if (sid === 'rooms') place('rooms', 'rooms', 4, 4);
    else if (sid.startsWith('field:')) {
      const fieldId = sid.slice(6);
      if (fields.some(f => f.id === fieldId)) {
        place('field', sid, 4, 3, fieldId);
      }
    }
  }

  // Ensure weather/calendar if missing from order but not hidden
  for (const kind of ['weather', 'calendar', 'scenes', 'rooms'] as WidgetKind[]) {
    if (!widgets.some(w => w.kind === kind) && !hidden.has(kind)) {
      const defaults: Record<string, [number, number]> = {
        weather: [2, 2], calendar: [2, 3], scenes: [4, 2], rooms: [4, 4],
      };
      const [w, h] = defaults[kind];
      place(kind, kind, w, h);
    }
  }

  const page: DashboardPage = { id: HOME_PAGE_ID, name: 'Home', widgets };
  return {
    version: 2,
    cols: { sm: 4, md: 8 },
    activePageId: HOME_PAGE_ID,
    pages: [page],
    fields,
    roomOrder: Array.isArray(parsed.roomOrder) ? parsed.roomOrder as number[] : [],
  };
}

function normalizeV2(parsed: Partial<DashboardLayout>): DashboardLayout {
  const base = createDefaultLayout();
  const pages = Array.isArray(parsed.pages) && parsed.pages.length > 0
    ? parsed.pages
    : base.pages;
  const fields = Array.isArray(parsed.fields) ? parsed.fields : base.fields;
  const activePageId = pages.some(p => p.id === parsed.activePageId)
    ? (parsed.activePageId as string)
    : pages[0].id;

  return {
    version: 2,
    cols: parsed.cols ?? base.cols,
    activePageId,
    pages,
    fields,
    roomOrder: Array.isArray(parsed.roomOrder) ? parsed.roomOrder : [],
  };
}

function load(): DashboardLayout {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (!raw) return createDefaultLayout();
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (p.version === 2 && Array.isArray(p.pages)) {
      return normalizeV2(p as Partial<DashboardLayout>);
    }
    return migrateFromV1(p);
  } catch {
    return createDefaultLayout();
  }
}

export function loadDashboardLayout(): DashboardLayout {
  return load();
}

export function useDashboardLayout(): DashboardLayout {
  const [layout, setLayout] = useState<DashboardLayout>(createDefaultLayout);

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

export function useDashboardLayoutState(): [DashboardLayout, (next: DashboardLayout) => void] {
  const [layout, setLayout] = useState<DashboardLayout>(createDefaultLayout);

  useEffect(() => {
    setLayout(load());
    const handler = (e: StorageEvent) => {
      if (e.key === DASHBOARD_LAYOUT_KEY) setLayout(load());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const save = useCallback((next: DashboardLayout) => {
    saveDashboardLayout(next);
    setLayout(next);
  }, []);

  return [layout, save];
}

export function saveDashboardLayout(layout: DashboardLayout): void {
  const payload: DashboardLayout = { ...layout, version: 2 };
  localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(payload));
  window.dispatchEvent(new StorageEvent('storage', { key: DASHBOARD_LAYOUT_KEY }));
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

export function createPageId(): string {
  return `page-${createFieldId().slice(0, 8)}`;
}

export function widgetLabel(kind: WidgetKind, fields: DashboardField[], fieldId?: string): string {
  if (kind === 'clock') return 'Uhr';
  if (kind === 'weather') return 'Wetter';
  if (kind === 'calendar') return 'Kalender';
  if (kind === 'scenes') return 'Szenen';
  if (kind === 'rooms') return 'Räume';
  if (kind === 'field') {
    return fields.find(f => f.id === fieldId)?.name ?? 'Geräte-Feld';
  }
  return kind;
}

export function fieldSectionId(fieldId: string): string {
  return `field:${fieldId}`;
}

/** Legacy export for any remaining imports */
export type { SectionId };
export function parseFieldSectionId(sectionId: string): string | null {
  return sectionId.startsWith('field:') ? sectionId.slice(6) : null;
}
export function sectionLabel(sectionId: string, fields: DashboardField[]): string {
  return widgetLabel(
    sectionId.startsWith('field:') ? 'field' : sectionId as WidgetKind,
    fields,
    parseFieldSectionId(sectionId) ?? undefined,
  );
}

export type DashboardLayoutV1Compat = {
  roomOrder: number[];
  sectionOrder: SectionId[];
  hiddenSections: SectionId[];
  fields: DashboardField[];
};
