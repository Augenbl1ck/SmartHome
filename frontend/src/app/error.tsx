'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  const isBackendDown =
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('fetch failed') ||
    error.message.includes('API error');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4 text-center">
      <AlertTriangle className="h-12 w-12 text-amber-500" />
      <h2 className="text-xl font-semibold">
        {isBackendDown ? 'Backend nicht erreichbar' : 'Etwas ist schiefgelaufen'}
      </h2>
      <p className="text-muted-foreground text-sm max-w-sm">
        {isBackendDown
          ? 'Das Backend läuft nicht. Starte es mit: cd backend && C:\\php82\\php.exe artisan serve'
          : error.message}
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
      >
        <RefreshCw className="h-4 w-4" />
        Erneut versuchen
      </button>
    </div>
  );
}
