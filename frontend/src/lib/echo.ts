import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

declare global {
  interface Window {
    Pusher: typeof Pusher;
    Echo: Echo<'reverb'>;
  }
}

let echo: Echo<'reverb'> | null = null;
let visibilityBound = false;
let dropping = false;
let lastDropAt = 0;

const resetListeners = new Set<() => void>();

type PusherConn = {
  state?: string;
  bind: (event: string, cb: (payload?: unknown) => void) => void;
};

function pusherConnection(instance: Echo<'reverb'> | null): PusherConn | null {
  if (!instance) return null;
  const conn = (instance.connector as { pusher?: { connection?: PusherConn } }).pusher?.connection;
  return conn ?? null;
}

function isDead(instance: Echo<'reverb'> | null): boolean {
  const state = pusherConnection(instance)?.state;
  return state === 'failed' || state === 'unavailable' || state === 'disconnected';
}

function notifyReset(): void {
  resetListeners.forEach((fn) => {
    try { fn(); } catch { /* listener */ }
  });
}

function dropEcho(): void {
  if (dropping) return;
  const now = Date.now();
  if (now - lastDropAt < 2000) return;
  dropping = true;
  lastDropAt = now;
  const current = echo;
  echo = null;
  try { current?.disconnect(); } catch { /* already gone */ }
  dropping = false;
  queueMicrotask(notifyReset);
}

/** Nach Verbindungsabbruch erneut subscriben (Kiosk bleibt oft stundenlang gemountet). */
export function onEchoReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => { resetListeners.delete(listener); };
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !echo) return;
    if (isDead(echo)) dropEcho();
  });
}

export function getEcho(): Echo<'reverb'> {
  if (typeof window === 'undefined') {
    throw new Error('Echo kann nur im Browser initialisiert werden');
  }

  bindVisibility();

  if (echo && isDead(echo)) {
    dropEcho();
  }
  if (echo) return echo;

  window.Pusher = Pusher;

  const isHttps = window.location.protocol === 'https:';
  const currentHost = window.location.hostname;
  const wsHost = isHttps ? currentHost : (process.env.NEXT_PUBLIC_REVERB_HOST ?? 'localhost');
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

  const created = echo;
  pusherConnection(created)?.bind('state_change', (payload) => {
    if (echo !== created) return;
    const next = (payload as { current?: string } | undefined)?.current;
    if (next === 'failed' || next === 'unavailable') dropEcho();
  });

  return created;
}

export function disconnectEcho(): void {
  if (echo) {
    try { echo.disconnect(); } catch { /* */ }
    echo = null;
  }
}
