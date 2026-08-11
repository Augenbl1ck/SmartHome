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
  return (
    <div
      className={cn(
        'h-full w-full rounded-2xl border bg-card overflow-hidden relative',
        editable && 'ring-1 ring-primary/30 shadow-sm',
        className,
      )}
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
              className="pointer-events-auto cursor-pointer h-7 w-7 rounded-full bg-destructive/90 text-destructive-foreground flex items-center justify-center active:scale-90"
              aria-label="Widget entfernen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className={cn('h-full w-full overflow-auto', editable && 'pt-8 pointer-events-none')}>
        {children}
      </div>
    </div>
  );
}
