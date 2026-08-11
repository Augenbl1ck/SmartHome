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
          if (!editable || !onLayoutChange) return;
          onLayoutChange(fromLayout(next, widgets, cols));
        }}
        draggableCancel=".no-drag"
      >
        {widgets.map(w => (
          <div key={w.id} className={cn(editable && 'animate-[wiggle_0.4s_ease-in-out_infinite]')}>
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
