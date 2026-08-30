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
import { api } from '@/lib/api';

const KEYS = {
  hash:          'smarthome_pin_hash',
  enabled:       'smarthome_pin_enabled',
  lockTimeout:   'smarthome_lock_timeout',
  screenTimeout: 'smarthome_screen_off_timeout',
} as const;

function persistToServer(patch: {
  pin_hash?: string | null;
  pin_enabled?: boolean;
  lock_timeout?: number;
  screen_timeout?: number;
}) {
  api.updatePanelSettings(patch).catch(() => {
    /* offline — localStorage bleibt Quelle */
  });
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const buf = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Fallback(data);
}

function sha256Fallback(data: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const toHex = (value: number) => value.toString(16).padStart(8, '0');
  const rotr = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const shaCh = (x: number, y: number, z: number) => (x & y) ^ (~x & z);
  const shaMaj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z);
  const shaSigma0 = (x: number) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
  const shaSigma1 = (x: number) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
  const shaSigmaSmall0 = (x: number) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
  const shaSigmaSmall1 = (x: number) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);

  const bytes = Array.from(data);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) {
    bytes.push(0x00);
  }
  const lengthBuffer = new DataView(new ArrayBuffer(8));
  lengthBuffer.setUint32(4, bitLength, false);
  bytes.push(...new Uint8Array(lengthBuffer.buffer));

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const w = new Uint32Array(64);
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t += 1) {
      const j = i + t * 4;
      w[t] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let t = 16; t < 64; t += 1) {
      w[t] = (shaSigmaSmall1(w[t - 2]) + w[t - 7] + shaSigmaSmall0(w[t - 15]) + w[t - 16]) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let t = 0; t < 64; t += 1) {
      const T1 = (h + shaSigma1(e) + shaCh(e, f, g) + K[t] + w[t]) >>> 0;
      const T2 = (shaSigma0(a) + shaMaj(a, b, c)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H).map(toHex).join('');
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
  // Server-Settings kommen asynchron — nach erfolgreichem Unlock nicht wieder sperren.
  const unlockedThisSession = useRef(false);

  // Server → localStorage (überlebt Reboot / anderen Browser-Origin)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getPanelSettings();
        if (cancelled) return;

        // local → server migrieren falls Server noch leer, lokal aber gesetzt
        const localHash = load<string>(KEYS.hash, '');
        if (!s.pin_hash && localHash) {
          persistToServer({
            pin_hash: localHash,
            pin_enabled: load<boolean>(KEYS.enabled, false),
            lock_timeout: load<number>(KEYS.lockTimeout, 30),
            screen_timeout: load<number>(KEYS.screenTimeout, 60),
          });
        }

        if (s.pin_hash) {
          save(KEYS.hash, s.pin_hash);
          setHasPin(true);
        } else if (!localHash) {
          localStorage.removeItem(KEYS.hash);
          setHasPin(false);
        }
        if (s.pin_hash || s.pin_enabled) {
          save(KEYS.enabled, s.pin_enabled);
          setEnabled(s.pin_enabled);
        }
        save(KEYS.lockTimeout, s.lock_timeout);
        setLockTimeoutS(s.lock_timeout);
        save(KEYS.screenTimeout, s.screen_timeout);
        setScreenTimeoutS(s.screen_timeout);
        if (s.pin_enabled && s.pin_hash && !unlockedThisSession.current) {
          setLocked(true);
        }
      } catch {
        /* API down — weiter mit localStorage */
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Intervall prüft jede Sekunde ob Timeouts erreicht sind.
  // Läuft auch im gesperrten Zustand weiter, damit die PIN-Tastatur
  // nach Bildschirm-Timeout wieder dunkel wird.
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!enabled) return;

    intervalRef.current = setInterval(() => {
      const idle = (Date.now() - lastActivity.current) / 1000;
      const lt = load<number>(KEYS.lockTimeout,   30);
      const st = load<number>(KEYS.screenTimeout, 60);

      if (lt > 0 && idle >= lt) {
        setLocked(true);
      }
      if (st > 0 && idle >= st) {
        setScreenOff(true);
      } else if (!locked) {
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
      unlockedThisSession.current = true;
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
      persistToServer({ pin_hash: newHash, pin_enabled: true });
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
    persistToServer({ pin_hash: null, pin_enabled: false });
  }, [clearTimers]);

  const setLockTimeout = useCallback((seconds: number) => {
    save(KEYS.lockTimeout, seconds);
    setLockTimeoutS(seconds);
    persistToServer({ lock_timeout: seconds });
  }, []);

  const setScreenTimeout = useCallback((seconds: number) => {
    save(KEYS.screenTimeout, seconds);
    setScreenTimeoutS(seconds);
    persistToServer({ screen_timeout: seconds });
  }, []);

  return {
    locked, screenOff, enabled, lockTimeout, screenTimeout,
    unlock, lock, wakeScreen, resetTimers,
    setPin, removePin, setLockTimeout, setScreenTimeout,
    hasPin,
  };
}
