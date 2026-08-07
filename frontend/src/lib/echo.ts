import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

declare global {
  interface Window {
    Pusher: typeof Pusher;
    Echo: Echo<'reverb'>;
  }
}

let echo: Echo<'reverb'> | null = null;

export function getEcho(): Echo<'reverb'> {
  if (echo) return echo;

  if (typeof window === 'undefined') {
    throw new Error('Echo kann nur im Browser initialisiert werden');
  }

  window.Pusher = Pusher;

  // Dynamisch HTTPS erkennen und WebSocket-Konfiguration anpassen
  const isHttps = window.location.protocol === 'https:';
  const currentHost = window.location.hostname;
  
  // Bei HTTPS nutzen wir den aktuellen Host (z.B. smarthome.taile4b6ab.ts.net)
  // Bei HTTP nutzen wir die konfigurierte Host (z.B. smarthome.local)
  const wsHost = isHttps ? currentHost : (process.env.NEXT_PUBLIC_REVERB_HOST ?? 'localhost');
  
  // Port: Nginx proxied WebSocket auf 80/443, also nutzen wir Standard-Ports
  const wsPort = isHttps ? 443 : 80;

  echo = new Echo({
    broadcaster: 'reverb',
    key:         process.env.NEXT_PUBLIC_REVERB_APP_KEY!,
    wsHost:      wsHost,
    wsPort:      wsPort,
    wssPort:     wsPort,
    forceTLS:    isHttps,
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
  });

  return echo;
}

export function disconnectEcho(): void {
  if (echo) {
    echo.disconnect();
    echo = null;
  }
}
