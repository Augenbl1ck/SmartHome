'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, Plus, Trash2, X, Pencil,
} from 'lucide-react';
import { Device, Room } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import DashboardGrid, { kindAlreadyOnPage } from '@/components/DashboardGrid';
import WeatherWidget from '@/components/WeatherWidget';
import CalendarWidget from '@/components/CalendarWidget';
import {
  loadDashboardLayout,
  saveDashboardLayout,
  createFieldId,
  createPageId,
  defaultWidgetsForPage,
  WIDGET_SIZE_LIMITS,
  type DashboardField,
  type DashboardLayout,
  type GridWidget,
  type WidgetKind,
} from '@/hooks/useDashboardLayout';

const ADDABLE: { kind: WidgetKind; label: string }[] = [
  { kind: 'clock', label: 'Uhr' },
  { kind: 'weather', label: 'Wetter' },
  { kind: 'calendar', label: 'Kalender' },
  { kind: 'scenes', label: 'Szenen' },
  { kind: 'rooms', label: 'Räume' },
];

function nextY(widgets: GridWidget[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
}

export default function DashboardSettingsEditor({
  devices,
  rooms,
}: {
  devices: Device[];
  rooms: Room[];
}) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [pageId, setPageId] = useState<string>('');
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [renamingPage, setRenamingPage] = useState(false);

  useEffect(() => {
    const l = loadDashboardLayout();
    setLayout(l);
    setPageId(l.activePageId || l.pages[0]?.id || '');
  }, []);

  const persist = (next: DashboardLayout) => {
    setLayout(next);
    saveDashboardLayout(next);
  };

  const page = layout?.pages.find(p => p.id === pageId) ?? layout?.pages[0];

  const updatePageWidgets = (widgets: GridWidget[]) => {
    if (!layout || !page) return;
    persist({
      ...layout,
      pages: layout.pages.map(p => p.id === page.id ? { ...p, widgets } : p),
    });
  };

  const removeWidget = (id: string) => {
    if (!page) return;
    updatePageWidgets(page.widgets.filter(w => w.id !== id));
  };

  const addWidget = (kind: WidgetKind) => {
    if (!layout || !page) return;
    if (kindAlreadyOnPage(page.widgets, kind)) return;
    const limits = WIDGET_SIZE_LIMITS[kind];
    const defaults: Record<WidgetKind, { w: number; h: number }> = {
      clock: { w: 12, h: 3 },
      weather: { w: 6, h: 4 },
      calendar: { w: 6, h: 5 },
      scenes: { w: 12, h: 3 },
      rooms: { w: 12, h: 7 },
      field: { w: 12, h: 5 },
    };
    const d = defaults[kind];
    const w: GridWidget = {
      id: kind,
      kind,
      x: 0,
      y: nextY(page.widgets),
      w: Math.min(Math.max(d.w, limits.minW), limits.maxW),
      h: Math.min(Math.max(d.h, limits.minH), limits.maxH),
    };
    updatePageWidgets([...page.widgets, w]);
  };

  const addFieldWidget = () => {
    if (!layout || !page) return;
    const id = createFieldId();
    const field: DashboardField = { id, name: `Feld ${layout.fields.length + 1}`, deviceIds: [] };
    const widget: GridWidget = {
      id: `field:${id}`,
      kind: 'field',
      fieldId: id,
      x: 0,
      y: nextY(page.widgets),
      w: 12,
      h: 5,
    };
    persist({
      ...layout,
      fields: [...layout.fields, field],
      pages: layout.pages.map(p =>
        p.id === page.id ? { ...p, widgets: [...p.widgets, widget] } : p,
      ),
    });
    setExpandedField(id);
  };

  const addPage = () => {
    if (!layout) return;
    const id = createPageId();
    const newPage = {
      id,
      name: `Seite ${layout.pages.length + 1}`,
      widgets: defaultWidgetsForPage([]).filter(w => w.kind !== 'field'),
    };
    persist({
      ...layout,
      pages: [...layout.pages, newPage],
      activePageId: id,
    });
    setPageId(id);
  };

  const resetPageLayout = () => {
    if (!layout || !page) return;
    const widgets = defaultWidgetsForPage(
      layout.fields.filter(f => page.widgets.some(w => w.fieldId === f.id || w.id === `field:${f.id}`)),
    );
    // Keep field widgets that exist on this page; rebuild builtins
    const fieldWidgets = page.widgets.filter(w => w.kind === 'field');
    let y = 0;
    const builtins = defaultWidgetsForPage([]).filter(w => w.kind !== 'field').map(w => {
      const next = { ...w, y };
      y += w.h;
      return next;
    });
    for (const fw of fieldWidgets) {
      const h = Math.max(fw.h, 5);
      builtins.push({ ...fw, x: 0, y, w: 12, h });
      y += h;
    }
    updatePageWidgets(builtins.length ? builtins : widgets);
  };

  const deletePage = (id: string) => {
    if (!layout || layout.pages.length <= 1) return;
    const pages = layout.pages.filter(p => p.id !== id);
    const nextId = pageId === id ? pages[0].id : pageId;
    persist({ ...layout, pages, activePageId: nextId });
    setPageId(nextId);
  };

  const renamePage = (name: string) => {
    if (!layout || !page) return;
    persist({
      ...layout,
      pages: layout.pages.map(p => p.id === page.id ? { ...p, name: name.trim() || p.name } : p),
    });
  };

  const selectableDevices = useMemo(
    () => [...devices].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [devices],
  );

  const updateFields = (fields: DashboardField[]) => {
    if (!layout) return;
    persist({ ...layout, fields });
  };

  if (!layout || !page) {
    return (
      <div className="rounded-2xl border bg-card p-5 animate-pulse space-y-3">
        <div className="h-4 bg-muted rounded w-40" />
        <div className="h-40 bg-muted rounded w-full" />
      </div>
    );
  }

  const renderers = {
    clock: () => (
      <div className="h-full flex items-center p-4">
        <p className="text-3xl font-bold tabular-nums">12:00</p>
        <p className="text-xs text-muted-foreground ml-3">Uhr-Widget</p>
      </div>
    ),
    weather: () => <WeatherWidget />,
    calendar: () => (
      <div className="h-full rounded-xl bg-card/90 p-3 text-sm text-muted-foreground">Kalender-Widget</div>
    ),
    scenes: () => (
      <div className="p-3 text-sm text-muted-foreground">Szenen-Leiste</div>
    ),
    rooms: () => (
      <div className="p-3 text-sm text-muted-foreground">
        {rooms.length} Raum{rooms.length !== 1 ? 'e' : ''}
      </div>
    ),
    field: (fieldId: string) => {
      const f = layout.fields.find(x => x.id === fieldId);
      return (
        <div className="p-3 text-sm">
          <p className="font-medium">{f?.name ?? 'Feld'}</p>
          <p className="text-xs text-muted-foreground">{f?.deviceIds.length ?? 0} Geräte</p>
        </div>
      );
    },
  };

  const missingKinds = ADDABLE.filter(a => !kindAlreadyOnPage(page.widgets, a.kind));

  return (
    <div className="space-y-6">
      {/* Seiten */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Seiten</p>
        <div className="flex flex-wrap gap-2 items-center">
          {layout.pages.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPageId(p.id)}
              className={cn(
                'cursor-pointer px-3 py-1.5 rounded-full text-sm border transition-colors',
                p.id === page.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card hover:bg-accent',
              )}
            >
              {p.name}
            </button>
          ))}
          <Button size="sm" variant="outline" onClick={addPage}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Seite
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {renamingPage ? (
            <input
              autoFocus
              defaultValue={page.name}
              onBlur={e => { renamePage(e.target.value); setRenamingPage(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  renamePage((e.target as HTMLInputElement).value);
                  setRenamingPage(false);
                }
              }}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm flex-1"
            />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setRenamingPage(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Umbenennen
            </Button>
          )}
          {layout.pages.length > 1 && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deletePage(page.id)}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Seite löschen
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={resetPageLayout}>
            Layout zurücksetzen
          </Button>
        </div>
      </div>

      {/* Editor-Vorschau */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Vorschau</p>
        <p className="text-xs text-muted-foreground mb-3">
          Widgets ziehen und an der Ecke vergrößern — wie auf dem Home-Bildschirm.
        </p>
        <div className="rounded-2xl border bg-muted/30 p-3 overflow-x-hidden overflow-y-auto max-h-[70vh]">
          <DashboardGrid
            widgets={page.widgets}
            fields={layout.fields}
            editable
            onLayoutChange={updatePageWidgets}
            onRemoveWidget={removeWidget}
            renderers={renderers}
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {missingKinds.map(a => (
            <Button key={a.kind} size="sm" variant="outline" onClick={() => addWidget(a.kind)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {a.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={addFieldWidget}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Geräte-Feld
          </Button>
        </div>
      </div>

      {/* Geräte-Felder konfigurieren */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Geräte-Felder</p>
        <p className="text-xs text-muted-foreground mb-3">
          Namen und Geräte für Feld-Widgets. Layout-Position oben in der Vorschau.
        </p>

        {layout.fields.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6 rounded-xl border border-dashed">
            Noch keine Felder — über „Geräte-Feld“ hinzufügen.
          </p>
        )}

        <div className="space-y-3">
          {layout.fields.map(field => {
            const isOpen = expandedField === field.id;
            const available = selectableDevices.filter(d => !field.deviceIds.includes(d.id));
            return (
              <div key={field.id} className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpandedField(isOpen ? null : field.id)}
                    className="cursor-pointer flex-1 flex items-center gap-2 text-left min-w-0"
                  >
                    <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-90')} />
                    <input
                      value={field.name}
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        const name = e.target.value;
                        updateFields(layout.fields.map(f =>
                          f.id === field.id ? { ...f, name: name.trim() || f.name } : f,
                        ));
                      }}
                      className="text-sm font-medium bg-transparent border-none outline-none flex-1 min-w-0"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">{field.deviceIds.length} Geräte</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const fields = layout.fields.filter(f => f.id !== field.id);
                      const pages = layout.pages.map(p => ({
                        ...p,
                        widgets: p.widgets.filter(w => w.fieldId !== field.id && w.id !== `field:${field.id}`),
                      }));
                      persist({ ...layout, fields, pages });
                      if (expandedField === field.id) setExpandedField(null);
                    }}
                    title="Feld löschen"
                    className="cursor-pointer h-7 w-7 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t pt-2">
                    {field.deviceIds.length > 0 && (
                      <div className="space-y-1">
                        {field.deviceIds.map((id, i) => {
                          const d = devices.find(x => x.id === id);
                          if (!d) return null;
                          return (
                            <div key={id} className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1.5">
                              <span className="text-xs font-bold text-primary w-4 shrink-0">{i + 1}</span>
                              <span className="text-sm flex-1 truncate">{d.name}</span>
                              <div className="flex gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={i === 0}
                                  onClick={() => {
                                    const ids = [...field.deviceIds];
                                    [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                                    updateFields(layout.fields.map(f =>
                                      f.id === field.id ? { ...f, deviceIds: ids } : f,
                                    ));
                                  }}
                                  className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                                >
                                  <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={i === field.deviceIds.length - 1}
                                  onClick={() => {
                                    const ids = [...field.deviceIds];
                                    [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                                    updateFields(layout.fields.map(f =>
                                      f.id === field.id ? { ...f, deviceIds: ids } : f,
                                    ));
                                  }}
                                  className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateFields(layout.fields.map(f =>
                                      f.id === field.id
                                        ? { ...f, deviceIds: f.deviceIds.filter(x => x !== id) }
                                        : f,
                                    ));
                                  }}
                                  className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {available.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gerät hinzufügen</p>
                        <div className="max-h-44 overflow-y-auto space-y-0.5">
                          {available.map(d => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => {
                                updateFields(layout.fields.map(f =>
                                  f.id === field.id && !f.deviceIds.includes(d.id)
                                    ? { ...f, deviceIds: [...f.deviceIds, d.id] }
                                    : f,
                                ));
                              }}
                              className="cursor-pointer w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-accent transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm flex-1 truncate">{d.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Raumreihenfolge */}
      {rooms.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Räume-Reihenfolge</p>
          <p className="text-xs text-muted-foreground mb-3">Reihenfolge der Raum-Kacheln im Räume-Widget.</p>
          <div className="space-y-1">
            {(layout.roomOrder.length === 0
              ? rooms
              : [...rooms].sort((a, b) => {
                  const ai = layout.roomOrder.indexOf(a.id);
                  const bi = layout.roomOrder.indexOf(b.id);
                  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                })
            ).map((room, i, arr) => (
              <div key={room.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className="text-base select-none w-6 text-center">{room.icon ?? '🏠'}</span>
                <span className="text-sm flex-1 truncate">{room.name}</span>
                <div className="flex gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => {
                      const ids = arr.map(r => r.id);
                      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                      persist({ ...layout, roomOrder: ids });
                    }}
                    className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === arr.length - 1}
                    onClick={() => {
                      const ids = arr.map(r => r.id);
                      [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                      persist({ ...layout, roomOrder: ids });
                    }}
                    className="cursor-pointer h-6 w-6 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
