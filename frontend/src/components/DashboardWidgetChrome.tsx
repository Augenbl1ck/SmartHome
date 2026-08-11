'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  editable: boolean;
  label?: string;
  onRemove?: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function DashboardWidgetChrome({
  editable,
  label,
  onRemove,
  children,
  className,
}: Props) {
  // #region agent log
  if (typeof window !== 'undefined' && label) {
    fetch('http://127.0.0.1:7707/ingest/a119e08c-94ad-4d21-bb0e-add8dc402a79',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ce13fd'},body:JSON.stringify({sessionId:'ce13fd',runId:'pre-fix',hypothesisId:'E',location:'DashboardWidgetChrome.tsx:render',message:'chrome render',data:{editable,label,contentPointerEventsNone:editable},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion
  return (
    <div
      className={cn(
        'h-full w-full rounded-2xl border bg-card overflow-hidden relative',
        editable && 'ring-2 ring-primary/40 shadow-md',
        className,
      )}
      data-edit={editable ? '1' : '0'}
    >
      {editable && (
        <div className="absolute top-1.5 left-1.5 right-1.5 z-10 flex items-center gap-1 pointer-events-none">
          {label && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-background/90 text-muted-foreground px-1.5 py-0.5 rounded">
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
      {/* Content stays interactive for drag handle area; only kill nested link clicks via parent editing flag */}
      <div className={cn('h-full w-full min-h-0', editable ? 'pt-8 overflow-hidden' : 'overflow-auto')}>
        {children}
      </div>
    </div>
  );
}
