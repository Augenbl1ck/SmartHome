'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { api, Device, DeviceType, Room, Scene, type CalendarEventsResponse } from '@/lib/api';
import { isToggleable } from '@/lib/devices';
import { DEVICE_UPDATE_EVENT } from '@/lib/device-events';
import { getEcho } from '@/lib/echo';
import { cn } from '@/lib/utils';
import DeviceFieldPanel from '@/components/DeviceFieldPanel';
import {
  useDashboardLayoutState,
  saveDashboardLayout,
  type GridWidget,
  type DashboardLayout,
} from '@/hooks/useDashboardLayout';
import DashboardActions from '@/components/DashboardActions';
import WeatherWidget from '@/components/WeatherWidget';
import CalendarWidget from '@/components/CalendarWidget';
import DashboardGrid from '@/components/DashboardGrid';
import { Button } from '@/components/ui/button';

interface Props {
  initialDevices: Device[];
  rooms: Room[];
  initialScenes: Scene[];
  initialCalendar: CalendarEventsResponse;
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

const LONG_PRESS_MS = 500;

export default function DashboardLive({ initialDevices, rooms, initialScenes, initialCalendar }: Props) {
  const [devices, setDevices] = useState<Device[]>(initialDevices);
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState('');
  const [running, setRunning] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());
  const [layout, setLayout] = useDashboardLayoutState();
  const [pageIndex, setPageIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [cols, setCols] = useState(4);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.getDevices();
      setDevices(fresh);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setMounted(true);
    refresh();

    const updateTime = () =>
      setTime(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
    updateTime();
    const clock = setInterval(updateTime, 1000);

    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(refresh, 5 * 60_000);

    const handler = (e: Event) => {
      const { id, status } = (e as CustomEvent<{ id: number; status: string }>).detail;
      setDevices(prev => prev.map(d => d.id === id ? { ...d, status } : d));
    };
    window.addEventListener(DEVICE_UPDATE_EVENT, handler);

    let echo: ReturnType<typeof getEcho> | null = null;
    try {
      echo = getEcho();
      echo.channel('devices').listen('.device.updated', (data: {
        id: number; status: string; attributes: Record<string, unknown>; last_seen: string;
      }) => {
        setDevices(prev => prev.map(d => d.id === data.id
          ? { ...d, status: data.status, attributes: data.attributes, last_seen: data.last_seen }
          : d
        ));
      });
    } catch (err) {
      console.warn('[WebSocket] Reverb nicht erreichbar, nur Polling aktiv', err);
    }

    const onResize = () => setCols(window.innerWidth >= 768 ? 8 : 4);
    onResize();
    window.addEventListener('resize', onResize);

    return () => {
      clearInterval(clock);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(DEVICE_UPDATE_EVENT, handler);
      window.removeEventListener('resize', onResize);
      if (echo) echo.leaveChannel('devices');
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, [refresh]);

  // Sync page index when layout pages change
  useEffect(() => {
    if (pageIndex >= layout.pages.length) setPageIndex(0);
  }, [layout.pages.length, pageIndex]);

  const list = devices;
  const activeDevices = list.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType)).length;

  const orderedRooms = useMemo(() => {
    const { roomOrder } = layout;
    if (roomOrder.length === 0) return rooms;
    return [...rooms].sort((a, b) => {
      const ai = roomOrder.indexOf(a.id);
      const bi = roomOrder.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [rooms, layout]);

  const page = layout.pages[pageIndex] ?? layout.pages[0];
  const fieldsById = useMemo(
    () => new Map(layout.fields.map(f => [f.id, f])),
    [layout.fields],
  );

  const updatePageWidgets = (widgets: GridWidget[]) => {
    if (!page) return;
    const next: DashboardLayout = {
      ...layout,
      pages: layout.pages.map(p => p.id === page.id ? { ...p, widgets } : p),
    };
    setLayout(next);
  };

  const removeWidget = (id: string) => {
    if (!page) return;
    updatePageWidgets(page.widgets.filter(w => w.id !== id));
  };

  const finishEdit = () => {
    setEditing(false);
    saveDashboardLayout(layout);
  };

  const startEdit = () => {
    try { navigator.vibrate?.(30); } catch { /* */ }
    // #region agent log
    fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'pre-fix',hypothesisId:'B-E',location:'DashboardLive.tsx:startEdit',message:'edit mode entered',data:{pageIndex,pageWidgets:page?.widgets?.length??0,cols},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setEditing(true);
  };

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const onBgPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    // Only long-press on background / chrome, not interactive children that stopPropagation
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      startEdit();
      clearPress();
    }, LONG_PRESS_MS);
  };

  const onBgPointerUp = () => clearPress();
  const onBgPointerLeave = () => clearPress();

  // Cancel long-press if moved too far
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!pressStart.current || !pressTimer.current) return;
      const dx = e.clientX - pressStart.current.x;
      const dy = e.clientY - pressStart.current.y;
      if (dx * dx + dy * dy > 100) clearPress();
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const activateScene = async (scene: Scene) => {
    if (editing || running.has(scene.id)) return;
    setRunning(r => new Set(r).add(scene.id));
    try {
      await api.activateScene(scene.id);
      setDone(d => new Set(d).add(scene.id));
      setTimeout(() => setDone(d => { const n = new Set(d); n.delete(scene.id); return n; }), 2000);
    } finally {
      setRunning(r => { const n = new Set(r); n.delete(scene.id); return n; });
    }
  };

  const goPage = (dir: number) => {
    setPageIndex(i => Math.max(0, Math.min(layout.pages.length - 1, i + dir)));
  };

  const onSwipeStart = (e: React.TouchEvent) => {
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onSwipeEnd = (e: React.TouchEvent) => {
    if (!swipeStart.current || editing) {
      swipeStart.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - swipeStart.current.x;
    const dy = e.changedTouches[0].clientY - swipeStart.current.y;
    swipeStart.current = null;
    // #region agent log
    fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'pre-fix',hypothesisId:'B',location:'DashboardLive.tsx:onSwipeEnd',message:'swipe end',data:{dx,dy,editing,pageIndex,pages:layout.pages.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goPage(1);
    else goPage(-1);
  };

  const renderers = {
    clock: () => (
      <div className="h-full flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-4xl sm:text-5xl font-bold tabular-nums leading-none tracking-tight" suppressHydrationWarning>
            {time || '\u00a0'}
          </p>
          <p className="text-sm text-muted-foreground mt-1" suppressHydrationWarning>
            {mounted ? getFormattedDate() : '\u00a0'}
          </p>
        </div>
        <div className={cn(
          'flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors shrink-0',
          activeDevices > 0
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground',
        )}>
          <span className={cn(
            'h-2 w-2 rounded-full',
            activeDevices > 0 ? 'bg-amber-500' : 'bg-muted-foreground/40',
          )} />
          {activeDevices > 0 ? `${activeDevices} aktiv` : 'Alles aus'}
        </div>
        <div className={cn('shrink-0', editing && 'pointer-events-none')}>
          <DashboardActions devices={list} />
        </div>
      </div>
    ),
    weather: () => <div className="p-1 h-full"><WeatherWidget /></div>,
    calendar: () => <div className="p-1 h-full"><CalendarWidget initial={initialCalendar} /></div>,
    scenes: () => (
      <div className="flex gap-3 overflow-x-auto p-3 h-full items-stretch scrollbar-none">
        {initialScenes.length === 0 ? (
          <p className="text-sm text-muted-foreground self-center">Keine Szenen</p>
        ) : initialScenes.map(scene => {
          const isRunning = running.has(scene.id);
          const isDone = done.has(scene.id);
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => activateScene(scene)}
              disabled={editing || isRunning}
              className={cn(
                'flex-shrink-0 flex flex-col items-center gap-2 rounded-2xl border p-3 min-w-[96px]',
                'transition-all duration-200 active:scale-[0.95] cursor-pointer no-drag',
                isDone
                  ? 'bg-green-500/15 border-green-400/40 text-green-600 dark:text-green-400'
                  : 'bg-background border-border hover:bg-accent/60',
                (isRunning || editing) && 'opacity-60 cursor-not-allowed',
              )}
            >
              <span className="text-2xl leading-none select-none">{isDone ? '✓' : scene.icon}</span>
              <span className="text-xs font-semibold text-center leading-tight line-clamp-2 w-full">
                {isDone ? 'Aktiviert' : scene.name}
              </span>
            </button>
          );
        })}
      </div>
    ),
    rooms: () => (
      <div className="grid grid-cols-2 gap-3 p-3 h-full overflow-auto content-start">
        {orderedRooms.map(room => {
          const roomDevices = list.filter(d => d.room_id === room.id);
          const active = roomDevices.filter(d => d.status === 'on' && isToggleable(d.type as DeviceType)).length;
          const inner = (
            <div className={cn(
              'rounded-2xl border p-4 flex flex-col gap-2 min-h-[120px]',
              'transition-all duration-300',
              active > 0
                ? 'bg-amber-500/15 border-amber-400/40'
                : 'bg-background border-border',
              !editing && 'hover:bg-accent/40 active:scale-[0.97] cursor-pointer',
            )}>
              <div className={cn(
                'w-11 h-11 rounded-xl flex items-center justify-center text-2xl select-none',
                active > 0 ? 'bg-amber-500/20' : 'bg-muted',
              )}>
                {room.icon ?? '🏠'}
              </div>
              <div className="mt-auto">
                <p className="font-semibold text-sm leading-tight">{room.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {active > 0 ? `${active} aktiv` : roomDevices.length > 0 ? 'Alles aus' : 'Keine Geräte'}
                </p>
              </div>
            </div>
          );
          if (editing) return <div key={room.id}>{inner}</div>;
          return <Link key={room.id} href={`/rooms/${room.id}`} className="no-drag">{inner}</Link>;
        })}
        {rooms.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-full py-8 text-center">Noch keine Räume.</p>
        )}
      </div>
    ),
    field: (fieldId: string) => {
      const field = fieldsById.get(fieldId);
      if (!field || field.deviceIds.length === 0) {
        return <p className="text-sm text-muted-foreground p-4">Keine Geräte in diesem Feld</p>;
      }
      return (
        <div className={cn('h-full overflow-auto', editing && 'pointer-events-none')}>
          <DeviceFieldPanel
            title={field.name}
            deviceIds={field.deviceIds}
            initialDevices={list}
          />
        </div>
      );
    },
  };

  if (!page) return null;

  return (
    <div className="flex flex-col gap-3">
      {editing && (
        <div className="sticky top-0 z-40 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur border-b flex items-center gap-3">
          <p className="text-sm font-medium flex-1">Layout bearbeiten — ziehen & Größe ändern</p>
          <Button size="sm" onClick={finishEdit}>Fertig</Button>
        </div>
      )}

      <div
        ref={pageRef}
        onTouchStart={editing ? undefined : onSwipeStart}
        onTouchEnd={editing ? undefined : onSwipeEnd}
        onPointerDown={editing ? undefined : onBgPointerDown}
        onPointerUp={editing ? undefined : onBgPointerUp}
        onPointerLeave={editing ? undefined : onBgPointerLeave}
      >
        <DashboardGrid
          widgets={page.widgets}
          fields={layout.fields}
          editable={editing}
          cols={cols}
          onLayoutChange={updatePageWidgets}
          onRemoveWidget={removeWidget}
          renderers={renderers}
        />
      </div>

      {layout.pages.length > 1 && (
        <div className="flex items-center justify-center gap-2 py-1">
          {layout.pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={p.name}
              onClick={() => setPageIndex(i)}
              className={cn(
                'cursor-pointer h-2 rounded-full transition-all',
                i === pageIndex ? 'w-5 bg-primary' : 'w-2 bg-muted-foreground/40',
              )}
            />
          ))}
        </div>
      )}

      {!editing && mounted && (
        <p className="text-[11px] text-center text-muted-foreground/70 pb-1">
          Lange drücken zum Bearbeiten
          {layout.pages.length > 1 ? ' · Wischen für weitere Seiten' : ''}
        </p>
      )}
    </div>
  );
}
