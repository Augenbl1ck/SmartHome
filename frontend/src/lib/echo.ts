import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

declare global {
  interface Window {
    Pusher: typeof Pusher;
    Echo: Echo;
  }
}

let echo: Echo | null = null;

export function getEcho(): Echo {
  if (echo) return echo;

  if (typeof window === 'undefined') {
    throw new Error('Echo kann nur im Browser initialisiert werden');
  }

  window.Pusher = Pusher;

  echo = new Echo({
    broadcaster: 'reverb',
    key:         process.env.NEXT_PUBLIC_REVERB_APP_KEY!,
    wsHost:      process.env.NEXT_PUBLIC_REVERB_HOST ?? 'localhost',
    wsPort:      Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
    wssPort:     Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
    forceTLS:    (process.env.NEXT_PUBLIC_REVERB_SCHEME ?? 'http') === 'https',
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
