'use client';

import { useMemo } from 'react';
import GridLayout, { WidthProvider } from 'react-grid-layout/legacy';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
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
  return widgets.map(w => {
    const limits = WIDGET_SIZE_LIMITS[w.kind];
    return {
      i: w.id,
      x: Math.min(Math.max(0, w.x), Math.max(0, cols - 1)),
      y: Math.max(0, w.y),
      w: Math.min(Math.max(w.w, limits.minW), Math.min(limits.maxW, cols)),
      h: Math.min(Math.max(w.h, limits.minH), limits.maxH),
      minW: Math.min(limits.minW, cols),
      minH: limits.minH,
      maxW: Math.min(limits.maxW, cols),
      maxH: limits.maxH,
    };
  });
}

function fromLayout(layout: readonly LayoutItem[], widgets: GridWidget[]): GridWidget[] {
  const byId = new Map(widgets.map(w => [w.id, w]));
  return layout.map(l => {
    const prev = byId.get(l.i);
    return {
      id: l.i,
      kind: prev?.kind ?? 'field',
      fieldId: prev?.fieldId,
      x: l.x,
      y: l.y,
      w: Math.max(1, l.w),
      h: Math.max(1, l.h),
    };
  });
}

export default function DashboardGrid({
  widgets,
  fields,
  editable,
  cols = GRID_COLS,
  rowHeight = GRID_ROW_HEIGHT,
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
    const mainEl = typeof document !== 'undefined' ? document.querySelector('main') as HTMLElement | null : null;
    const mainPad = mainEl ? getComputedStyle(mainEl) : null;
    fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'ux-grid-v3',hypothesisId:'G-H-I',location:'DashboardGrid.tsx:render',message:'fine grid render',data:{editable,cols,rowHeight,margin:GRID_MARGIN,compactType:null,preventCollision:true,widgetCount:widgets.length,layoutSample:layout.slice(0,3),widgetsSample:widgets.slice(0,3).map(w=>({id:w.id,x:w.x,y:w.y,w:w.w,h:w.h})),containerWidth:el?.offsetWidth??null,firstItemTransform:firstItem?.style?.transform||null,firstItemWidth:firstItem?.offsetWidth??null,mainPaddingLeft:mainPad?.paddingLeft??null,mainPaddingRight:mainPad?.paddingRight??null},timestamp:Date.now()})}).catch(()=>{});
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
        margin={GRID_MARGIN}
        containerPadding={[0, 0] as [number, number]}
        isDraggable={editable}
        isResizable={editable}
        compactType={null}
        preventCollision
        allowOverlap={false}
        useCSSTransforms
        onLayoutChange={(next) => {
          // #region agent log
          const ys = next.map(i => i.y).sort((a, b) => a - b);
          const gaps = ys.length > 1 ? ys.some((y, i) => i > 0 && y > ys[i - 1] + 1) : false;
          fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'ux-grid-v3',hypothesisId:'I',location:'DashboardGrid.tsx:onLayoutChange',message:'layout change nocompact',data:{editable,cols,itemCount:next.length,positions:next.map(i=>({i:i.i,x:i.x,y:i.y,w:i.w,h:i.h})),possibleVerticalGaps:gaps},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (!editable || !onLayoutChange) return;
          onLayoutChange(fromLayout(next, widgets));
        }}
        onDragStart={() => {
          // #region agent log
          fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'ux-grid-v3',hypothesisId:'I',location:'DashboardGrid.tsx:onDragStart',message:'drag started',data:{editable,cols},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }}
        draggableCancel=".no-drag"
      >
        {widgets.map(w => (
          <div key={w.id}>
            <DashboardWidgetChrome
              editable={editable}
              kind={w.kind}
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
