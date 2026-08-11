'use client';

import { api } from '@/lib/api';

const FAV_KEY = 'smarthome_favorites';
const FAV_EVENT = 'smarthome-favorites';

export function loadFavoritesLocal(): number[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function cacheFavorites(ids: number[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch { /* */ }
  window.dispatchEvent(new CustomEvent(FAV_EVENT));
  window.dispatchEvent(new StorageEvent('storage', { key: FAV_KEY }));
}

/** Load favorites from server (migrate local once if server empty). */
export async function syncFavoritesFromServer(): Promise<number[]> {
  const local = loadFavoritesLocal();
  try {
    const s = await api.getPanelSettings();
    const remote = Array.isArray(s.favorites) ? s.favorites.map(Number) : [];
    if (remote.length > 0) {
      cacheFavorites(remote);
      return remote;
    }
    if (local.length > 0) {
      await api.updatePanelSettings({ favorites: local });
      return local;
    }
    return [];
  } catch {
    return local;
  }
}

export async function saveFavorites(ids: number[]): Promise<void> {
  const next = Array.from(new Set(ids.map(Number)));
  cacheFavorites(next);
  try {
    await api.updatePanelSettings({ favorites: next });
  } catch { /* */ }
}

export function subscribeFavorites(cb: () => void): () => void {
  const onChange = () => cb();
  window.addEventListener(FAV_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(FAV_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
