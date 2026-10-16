'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { ensurePersonalProfile, isAndroidApp, rememberPersonal } from '@/lib/app-personal';

export const DASHBOARD_LAYOUT_KEY = 'smarthome_dashboard_layout';
const FAVORITES_KEY = 'smarthome_favorites';
const LEGACY_WIDGETS_KEY = 'smarthome_dashboard_widgets';
const LAYOUT_EVENT = 'smarthome-dashboard-layout';
const DEFAULT_PAGE_ID = 'home';
const DEFAULT_FIELD_ID = 'default-quickaccess';

export type BuiltInSectionId = 'clock' | 'weather' | 'calendar' | 'transit' | 'energy' | 'spotify' | 'scenes' | 'rooms';
export type SectionId = BuiltInSectionId | `field:${string}`;

export interface DashboardField {
  id: string;
  name: string;
  deviceIds: number[];
}

export interface DashboardPage {
  id: string;
  name: string;
  sectionOrder: SectionId[];
}

export interface DashboardLayout {
  pages: DashboardPage[];
  roomOrder: number[];
  sectionOrder: SectionId[];
  hiddenSections: SectionId[];
  fields: DashboardField[];
  /** Raum-ID → Sensor-/Thermostat-Geräte-ID für die Temperatur auf der Raumkachel. */
  roomTemperatureDeviceIds: Record<string, number>;
}

export const BUILTIN_SECTIONS: BuiltInSectionId[] = [
  'clock', 'weather', 'calendar', 'transit', 'energy', 'spotify', 'scenes', 'rooms',
];

const DEFAULT_HOME_SECTIONS: SectionId[] = [
  'clock', 'weather', 'calendar', 'transit', 'energy', 'spotify', 'scenes', 'rooms', `field:${DEFAULT_FIELD_ID}`,
];

const DEFAULT: DashboardLayout = {
  pages: [{ id: DEFAULT_PAGE_ID, name: 'Home', sectionOrder: DEFAULT_HOME_SECTIONS }],
  roomOrder: [],
  sectionOrder: DEFAULT_HOME_SECTIONS,
  hiddenSections: [],
  fields: [{ id: DEFAULT_FIELD_ID, name: 'Schnellzugriff', deviceIds: [] }],
  roomTemperatureDeviceIds: {},
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

function normalizeRoomTempIds(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isInteger(id) && id > 0) out[String(k)] = id;
  }
  return out;
}

function isValidSection(s: string, validFieldIds: Set<string>): s is SectionId {
  if (isBuiltin(s)) return true;
  if (s.startsWith('field:')) return validFieldIds.has(s.slice(6));
  return false;
}

function uniqueSections(ids: SectionId[]): SectionId[] {
  const seen = new Set<string>();
  const out: SectionId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function injectMissingBuiltins(sectionOrder: string[]): string[] {
  const next = sectionOrder.slice();
  for (const builtin of ['weather', 'calendar', 'transit', 'energy', 'spotify'] as const) {
    if (next.includes(builtin)) continue;
    if (builtin === 'transit') {
      const calIdx = next.indexOf('calendar');
      if (calIdx >= 0) next.splice(calIdx + 1, 0, builtin);
      else next.unshift(builtin);
    } else if (builtin === 'energy') {
      const trIdx = next.indexOf('transit');
      if (trIdx >= 0) next.splice(trIdx + 1, 0, builtin);
      else {
        const calIdx = next.indexOf('calendar');
        if (calIdx >= 0) next.splice(calIdx + 1, 0, builtin);
        else next.unshift(builtin);
      }
    } else if (builtin === 'spotify') {
      const enIdx = next.indexOf('energy');
      if (enIdx >= 0) next.splice(enIdx + 1, 0, builtin);
      else {
        const trIdx = next.indexOf('transit');
        if (trIdx >= 0) next.splice(trIdx + 1, 0, builtin);
        else next.unshift(builtin);
      }
    } else {
      next.unshift(builtin);
    }
  }
  return next;
}

function migrateLegacy(parsed: Partial<DashboardLayout> & { sectionOrder?: string[]; pages?: DashboardPage[] }): DashboardLayout {
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
  sectionOrder = sectionOrder.filter(s => isValidSection(s, validFieldIds));
  sectionOrder = injectMissingBuiltins(sectionOrder);

  for (const field of fields) {
    const sid = `field:${field.id}`;
    if (!sectionOrder.includes(sid)) sectionOrder.push(sid);
  }

  const hidden = hiddenSections
    .map(s => s === 'quickaccess' ? `field:${fields[0]?.id ?? DEFAULT_FIELD_ID}` : s)
    .filter(s => isValidSection(s, validFieldIds)) as SectionId[];

  const hiddenSet = new Set(hidden);
  let pages: DashboardPage[] = [];
  if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
    pages = parsed.pages
      .filter(p => p && typeof p === 'object')
      .map((p, i) => ({
        id: typeof p.id === 'string' && p.id ? p.id : `page-${i}`,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Seite ${i + 1}`,
        sectionOrder: uniqueSections(
          (Array.isArray(p.sectionOrder) ? p.sectionOrder : [])
            .filter((s): s is SectionId => typeof s === 'string' && isValidSection(s, validFieldIds)),
        ),
      }));
  }

  if (pages.length === 0) {
    const visible = uniqueSections(
      (sectionOrder as SectionId[]).filter(s => !hiddenSet.has(s)),
    );
    if (!visible.includes('clock')) visible.unshift('clock');
    pages = [{ id: DEFAULT_PAGE_ID, name: 'Home', sectionOrder: visible.length ? visible : ['clock'] }];
  } else {
    const clockOnPage = pages.some(p => p.sectionOrder.includes('clock'));
    if (!clockOnPage) {
      pages[0] = { ...pages[0], sectionOrder: ['clock', ...pages[0].sectionOrder] };
    }
  }

  const onAPage = new Set<string>();
  for (const page of pages) {
    for (const s of page.sectionOrder) onAPage.add(s);
  }

  const flattened = uniqueSections([
    ...pages.flatMap(p => p.sectionOrder),
    ...(sectionOrder as SectionId[]),
  ]);
  const nextHidden = flattened.filter(s => !onAPage.has(s));

  return {
    pages,
    roomOrder,
    sectionOrder: flattened.length > 0 ? flattened : DEFAULT.sectionOrder,
    hiddenSections: nextHidden,
    fields,
    roomTemperatureDeviceIds: normalizeRoomTempIds(parsed.roomTemperatureDeviceIds),
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
  if (layout.pages.length > 1) return true;
  if (layout.pages[0]?.name !== 'Home') return true;
  const defPage = DEFAULT.pages[0].sectionOrder.join(',');
  if ((layout.pages[0]?.sectionOrder ?? []).join(',') !== defPage) return true;
  const defOrder = DEFAULT.sectionOrder.join(',');
  if (layout.sectionOrder.join(',') !== defOrder) return true;
  if (layout.fields.length !== 1) return true;
  if (layout.fields[0]?.name !== 'Schnellzugriff') return true;
  if (Object.keys(layout.roomTemperatureDeviceIds ?? {}).length > 0) return true;
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
      const personal = await ensurePersonalProfile();
      if (cancelled) return;
      if (personal) {
        apply(loadLocal());
        return;
      }

      const local = loadLocal();
      setLayout(local);

      try {
        const s = await api.getPanelSettings();
        if (cancelled) return;

        if (s.dashboard_layout && typeof s.dashboard_layout === 'object') {
          apply(migrateLegacy(s.dashboard_layout as Partial<DashboardLayout>));
          return;
        }

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
  if (isAndroidApp()) {
    rememberPersonal({ dashboard_layout: normalized });
    return;
  }
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

export const createPageId = createFieldId;

export function fieldSectionId(fieldId: string): SectionId {
  return `field:${fieldId}`;
}

export function parseFieldSectionId(sectionId: SectionId): string | null {
  return sectionId.startsWith('field:') ? sectionId.slice(6) : null;
}

export function allAssignableSections(fields: DashboardField[]): SectionId[] {
  return [...BUILTIN_SECTIONS, ...fields.map(f => fieldSectionId(f.id))];
}

export function sectionLabel(sectionId: SectionId, fields: DashboardField[]): string {
  if (sectionId === 'clock') return 'Uhr';
  if (sectionId === 'weather') return 'Wetter';
  if (sectionId === 'calendar') return 'Kalender';
  if (sectionId === 'transit') return 'Bahn';
  if (sectionId === 'energy') return 'Energie';
  if (sectionId === 'spotify') return 'Spotify';
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
