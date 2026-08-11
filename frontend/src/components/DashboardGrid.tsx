'use client';

import { useMemo } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout/legacy';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  WIDGET_SIZE_LIMITS,
  widgetLabel,
  type DashboardField,
  type GridWidget,
  type WidgetKind,
} from '@/hooks/useDashboardLayout';
import DashboardWidgetChrome from '@/components/DashboardWidgetChrome';
import { cn } from '@/lib/utils';

const ResponsiveGrid = WidthProvider(GridLayout);

export interface DashboardGridRenderers {
  clock: () => React.ReactNode;
  weather: () => React.ReactNode;
  calendar: () => React.ReactNode;
  scenes: () => React.ReactNode;
  rooms: () => React.ReactNode;
  field: (fieldId: string) => React.ReactNode;
}

interface Props {
  widgets: GridWidget[];
  fields: DashboardField[];
  editable: boolean;
  cols?: number;
  rowHeight?: number;
  onLayoutChange?: (widgets: GridWidget[]) => void;
  onRemoveWidget?: (id: string) => void;
  renderers: DashboardGridRenderers;
  className?: string;
}

function toLayout(widgets: GridWidget[], cols: number): LayoutItem[] {
  const scale = cols >= 8 ? 2 : 1;
  return widgets.map(w => {
    const limits = WIDGET_SIZE_LIMITS[w.kind];
    const rawW = w.w * scale;
    const rawX = w.x * scale;
    return {
      i: w.id,
      x: Math.min(rawX, Math.max(0, cols - 1)),
      y: w.y,
      w: Math.min(Math.max(rawW, limits.minW * scale), Math.min(limits.maxW * scale, cols)),
      h: Math.min(Math.max(w.h, limits.minH), limits.maxH),
      minW: Math.min(limits.minW * scale, cols),
      minH: limits.minH,
      maxW: Math.min(limits.maxW * scale, cols),
      maxH: limits.maxH,
    };
  });
}

function fromLayout(layout: readonly LayoutItem[], widgets: GridWidget[], cols: number): GridWidget[] {
  const scale = cols >= 8 ? 2 : 1;
  const byId = new Map(widgets.map(w => [w.id, w]));
  return layout.map(l => {
    const prev = byId.get(l.i);
    return {
      id: l.i,
      kind: prev?.kind ?? 'field',
      fieldId: prev?.fieldId,
      x: Math.round(l.x / scale),
      y: l.y,
      w: Math.max(1, Math.round(l.w / scale)),
      h: l.h,
    };
  });
}

export default function DashboardGrid({
  widgets,
  fields,
  editable,
  cols = 4,
  rowHeight = 80,
  onLayoutChange,
  onRemoveWidget,
  renderers,
  className,
}: Props) {
  const layout = useMemo(() => toLayout(widgets, cols), [widgets, cols]);

  // #region agent log
  if (typeof window !== 'undefined') {
    const el = typeof document !== 'undefined' ? document.querySelector('.react-grid-layout') as HTMLElement | null : null;
    const firstItem = typeof document !== 'undefined' ? document.querySelector('.react-grid-item') as HTMLElement | null : null;
    const cssLoaded = typeof document !== 'undefined' && [...document.styleSheets].some(s => {
      try { return (s.href || '').includes('react-grid-layout') || [...(s.cssRules || [])].some(r => (r as CSSStyleRule).selectorText?.includes('react-grid-item')); }
      catch { return false; }
    });
    fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'pre-fix',hypothesisId:'A-D',location:'DashboardGrid.tsx:render',message:'grid render state',data:{editable,cols,rowHeight,widgetCount:widgets.length,layoutSample:layout.slice(0,3),widgetsSample:widgets.slice(0,3).map(w=>({id:w.id,x:w.x,y:w.y,w:w.w,h:w.h})),containerWidth:el?.offsetWidth??null,containerHeight:el?.offsetHeight??null,firstItemTransform:firstItem?.style?.transform||null,firstItemWidth:firstItem?.offsetWidth??null,firstItemHeight:firstItem?.offsetHeight??null,cssLoaded,hasReactGridClass:!!el},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion

  const renderBody = (w: GridWidget) => {
    switch (w.kind) {
      case 'clock': return renderers.clock();
      case 'weather': return renderers.weather();
      case 'calendar': return renderers.calendar();
      case 'scenes': return renderers.scenes();
      case 'rooms': return renderers.rooms();
      case 'field': return w.fieldId ? renderers.field(w.fieldId) : null;
      default: return null;
    }
  };

  return (
    <div className={cn('w-full min-h-[200px]', className)}>
      <ResponsiveGrid
        className="layout"
        layout={layout}
        cols={cols}
        rowHeight={rowHeight}
        margin={[12, 12] as [number, number]}
        containerPadding={[0, 0] as [number, number]}
        isDraggable={editable}
        isResizable={editable}
        compactType="vertical"
        preventCollision={false}
        useCSSTransforms
        onLayoutChange={(next) => {
          // #region agent log
          const first = next[0];
          fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'post-fix',hypothesisId:'E',location:'DashboardGrid.tsx:onLayoutChange',message:'layout change after wiggle fix',data:{editable,cols,firstXY:first?{i:first.i,x:first.x,y:first.y,w:first.w,h:first.h}:null,itemCount:next.length,domTransforms:[...document.querySelectorAll('.react-grid-item')].slice(0,4).map(el=>(el as HTMLElement).style.transform||getComputedStyle(el).transform)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (!editable || !onLayoutChange) return;
          onLayoutChange(fromLayout(next, widgets, cols));
        }}
        onDragStart={() => {
          // #region agent log
          fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'pre-fix',hypothesisId:'B',location:'DashboardGrid.tsx:onDragStart',message:'drag started',data:{editable,cols},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }}
        draggableCancel=".no-drag"
      >
        {widgets.map(w => (
          <div key={w.id}>
            <DashboardWidgetChrome
              editable={editable}
              label={widgetLabel(w.kind, fields, w.fieldId)}
              onRemove={editable && onRemoveWidget ? () => onRemoveWidget(w.id) : undefined}
            >
              {renderBody(w)}
            </DashboardWidgetChrome>
          </div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}

export function kindAlreadyOnPage(widgets: GridWidget[], kind: WidgetKind): boolean {
  if (kind === 'field') return false;
  return widgets.some(w => w.kind === kind);
}
