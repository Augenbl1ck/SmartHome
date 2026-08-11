'use client';

import { api } from '@/lib/api';

declare global {
  interface Window {
    Spotify?: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyWebPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export interface SpotifyWebPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (state: unknown) => void) => void;
  removeListener: (event: string, cb?: (state: unknown) => void) => void;
  getCurrentState: () => Promise<unknown>;
  setVolume: (v: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  activateElement: () => Promise<void>;
}

let sdkPromise: Promise<void> | null = null;

export function loadSpotifySdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const prev = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => reject(new Error('Spotify SDK konnte nicht geladen werden'));
    document.body.appendChild(script);
  });

  return sdkPromise;
}

export async function createPanelPlayer(
  onDeviceId: (id: string) => void,
  onError?: (msg: string) => void,
): Promise<SpotifyWebPlayer> {
  await loadSpotifySdk();
  if (!window.Spotify) throw new Error('Spotify SDK nicht bereit');

  const player = new window.Spotify.Player({
    name: 'SmartHome Panel',
    getOAuthToken: (cb) => {
      void api.getSpotifyToken()
        .then((t) => cb(t.access_token))
        .catch((e) => onError?.(e instanceof Error ? e.message : 'Token fehlgeschlagen'));
    },
    volume: 0.7,
  });

  player.addListener('ready', (state) => {
    const s = state as { device_id?: string };
    if (s.device_id) onDeviceId(s.device_id);
  });

  player.addListener('not_ready', () => {
    onError?.('Panel-Player offline');
  });

  player.addListener('initialization_error', (s) => {
    const msg = (s as { message?: string }).message ?? 'Init-Fehler';
    onError?.(msg);
  });
  player.addListener('authentication_error', (s) => {
    const msg = (s as { message?: string }).message ?? 'Auth-Fehler';
    onError?.(msg);
  });
  player.addListener('account_error', (s) => {
    const msg = (s as { message?: string }).message ?? 'Account-Fehler (Premium?)';
    onError?.(msg);
  });

  const ok = await player.connect();
  if (!ok) throw new Error('Spotify Player connect fehlgeschlagen');

  return player;
}
