'use client';

/**
 * usePinLock — globaler PIN-Sperr-Hook
 *
 * Speichert in localStorage:
 *   smarthome_pin_hash   → SHA-256 des PINs (kein Klartext)
 *   smarthome_pin_enabled → boolean
 *   smarthome_lock_timeout → Sekunden bis Auto-Lock (0 = nie)
 *   smarthome_screen_off_timeout → Sekunden bis "Bildschirm aus" (0 = nie)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const KEYS = {
  hash:          'smarthome_pin_hash',
  enabled:       'smarthome_pin_enabled',
  lockTimeout:   'smarthome_lock_timeout',
  screenTimeout: 'smarthome_screen_off_timeout',
} as const;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export interface PinLockState {
  // Status
  locked: boolean;
  screenOff: boolean;
  enabled: boolean;
  lockTimeout: number;   // Sekunden, 0 = nie
  screenTimeout: number; // Sekunden, 0 = nie

  // Aktionen
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  wakeScreen: () => void;
  resetTimers: () => void;

  // Einstellungen
  setPin: (oldPin: string | null, newPin: string) => Promise<boolean>;
  removePin: () => void;
  setLockTimeout: (seconds: number) => void;
  setScreenTimeout: (seconds: number) => void;
  hasPin: boolean;
}

export function usePinLock(): PinLockState {
  const [enabled,       setEnabled]       = useState(() => typeof window !== 'undefined' ? load<boolean>(KEYS.enabled, false) : false);
  const [locked,        setLocked]        = useState(() => {
    if (typeof window === 'undefined') return false;
    return load<boolean>(KEYS.enabled, false) && !!localStorage.getItem(KEYS.hash);
  });
  const [screenOff,     setScreenOff]     = useState(false);
  const [lockTimeout,   setLockTimeoutS]  = useState(() => typeof window !== 'undefined' ? load<number>(KEYS.lockTimeout, 30) : 30);
  const [screenTimeout, setScreenTimeoutS] = useState(() => typeof window !== 'undefined' ? load<number>(KEYS.screenTimeout, 60) : 60);
  const [hasPin,        setHasPin]        = useState(() => typeof window !== 'undefined' ? !!localStorage.getItem(KEYS.hash) : false);

  const lastActivity = useRef<number>(Date.now());
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Aktivitäts-Listener — nur explizites Tippen/Klicken
  useEffect(() => {
    const onActivity = () => { lastActivity.current = Date.now(); };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown',     onActivity);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown',     onActivity);
    };
  }, []);

  // Intervall prüft jede Sekunde ob Timeouts erreicht sind
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!enabled || locked) return;

    intervalRef.current = setInterval(() => {
      const idle = (Date.now() - lastActivity.current) / 1000;
      const lt = load<number>(KEYS.lockTimeout,   30);
      const st = load<number>(KEYS.screenTimeout, 60);

      if (lt > 0 && idle >= lt) {
        setLocked(true);
      } else if (st > 0 && idle >= st) {
        setScreenOff(true);
      } else {
        setScreenOff(false);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, locked]);

  const resetTimers = useCallback(() => {
    lastActivity.current = Date.now();
    setScreenOff(false);
  }, []);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    const stored = load<string>(KEYS.hash, '');
    if (!stored) return true;
    const hash = await sha256(pin);
    if (hash === stored) {
      setLocked(false);
      setScreenOff(false);
      return true;
    }
    return false;
  }, []);

  const lock = useCallback(() => {
    clearTimers();
    setLocked(true);
  }, [clearTimers]);

  const wakeScreen = useCallback(() => {
    lastActivity.current = Date.now();
    setScreenOff(false);
  }, []);

  const setPin = useCallback(
    async (oldPin: string | null, newPin: string): Promise<boolean> => {
      const stored = load<string>(KEYS.hash, '');
      // Wenn schon ein PIN gesetzt ist, alten prüfen
      if (stored && oldPin !== null) {
        const oldHash = await sha256(oldPin);
        if (oldHash !== stored) return false;
      }
      const newHash = await sha256(newPin);
      save(KEYS.hash, newHash);
      save(KEYS.enabled, true);
      setHasPin(true);
      setEnabled(true);
      return true;
    },
    []
  );

  const removePin = useCallback(() => {
    localStorage.removeItem(KEYS.hash);
    save(KEYS.enabled, false);
    setHasPin(false);
    setEnabled(false);
    setLocked(false);
    clearTimers();
  }, [clearTimers]);

  const setLockTimeout = useCallback((seconds: number) => {
    save(KEYS.lockTimeout, seconds);
    setLockTimeoutS(seconds);
  }, []);

  const setScreenTimeout = useCallback((seconds: number) => {
    save(KEYS.screenTimeout, seconds);
    setScreenTimeoutS(seconds);
  }, []);

  return {
    locked, screenOff, enabled, lockTimeout, screenTimeout,
    unlock, lock, wakeScreen, resetTimers,
    setPin, removePin, setLockTimeout, setScreenTimeout,
    hasPin,
  };
}
