'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WidgetKind } from '@/hooks/useDashboardLayout';

interface Props {
  editable: boolean;
  kind?: WidgetKind;
  label?: string;
  onRemove?: () => void;
  children: React.ReactNode;
  className?: string;
}

/** Widgets that already draw their own card — chrome stays invisible in view mode. */
const SELF_CHROME: Partial<Record<WidgetKind, true>> = {
  weather: true,
  calendar: true,
};

export default function DashboardWidgetChrome({
  editable,
  kind,
  label,
  onRemove,
  children,
  className,
}: Props) {
  const selfChrome = kind ? SELF_CHROME[kind] : false;

  // #region agent log
  if (typeof window !== 'undefined' && label) {
    fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'ux-grid-v3',hypothesisId:'H',location:'DashboardWidgetChrome.tsx:render',message:'chrome mode',data:{editable,label,kind,selfChrome,viewShell:!editable&&!selfChrome},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion

  return (
    <div
      className={cn(
        'h-full w-full relative overflow-hidden',
        editable
          ? 'rounded-xl border border-dashed border-primary/35 bg-card/40 shadow-sm ring-1 ring-primary/20'
          : selfChrome
            ? 'bg-transparent'
            : 'rounded-xl bg-card/80',
        className,
      )}
      data-edit={editable ? '1' : '0'}
      data-kind={kind}
    >
      {editable && (
        <div className="absolute top-1 left-1 right-1 z-10 flex items-center gap-1 pointer-events-none">
          {label && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-background/95 text-muted-foreground px-1.5 py-0.5 rounded-md border border-border/60">
              {label}
            </span>
          )}
          <div className="flex-1" />
          {onRemove && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemove(); }}
              className="pointer-events-auto cursor-pointer h-7 w-7 rounded-full bg-destructive/90 text-destructive-foreground flex items-center justify-center active:scale-90 no-drag"
              aria-label="Widget entfernen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className={cn('h-full w-full min-h-0', editable ? 'pt-7 overflow-hidden' : 'overflow-auto')}>
        {children}
      </div>
    </div>
  );
}
