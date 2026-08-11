'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  Search,
  ListMusic,
  Speaker,
  Loader2,
} from 'lucide-react';
import {
  api,
  type SpotifyDevice,
  type SpotifyPlayerState,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from '@/lib/api';
import { createPanelPlayer, type SpotifyWebPlayer } from '@/lib/spotify-player';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function SpotifyWidget() {
  const [player, setPlayer] = useState<SpotifyPlayerState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [queue, setQueue] = useState<SpotifyTrack[]>([]);
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'now' | 'search' | 'queue'>('now');
  const [panelDeviceId, setPanelDeviceId] = useState<string | null>(null);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sdkRef = useRef<SpotifyWebPlayer | null>(null);
  const panelIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, d, q] = await Promise.all([
        api.getSpotifyPlayer(),
        api.getSpotifyDevices().catch(() => ({ devices: [] as SpotifyDevice[] })),
        api.getSpotifyQueue().catch(() => ({ currently_playing: null, queue: [] as SpotifyTrack[] })),
      ]);
      setPlayer(p);
      setDevices(d.devices ?? []);
      setQueue(q.queue ?? []);
    } catch (e) {
      setPlayer({
        configured: false,
        connected: false,
        active: false,
        error: e instanceof Error ? e.message : 'Spotify nicht erreichbar',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!player?.connected) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await createPanelPlayer(
          (id) => {
            if (cancelled) return;
            panelIdRef.current = id;
            setPanelDeviceId(id);
          },
          (msg) => {
            if (!cancelled) setSdkError(msg);
          },
        );
        if (cancelled) {
          p.disconnect();
          return;
        }
        sdkRef.current = p;
      } catch (e) {
        if (!cancelled) {
          setSdkError(e instanceof Error ? e.message : 'Panel-Player fehlgeschlagen');
        }
      }
    })();
    return () => {
      cancelled = true;
      sdkRef.current?.disconnect();
      sdkRef.current = null;
    };
  }, [player?.connected]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = () => {
    void run(async () => {
      if (player?.is_playing) {
        await api.spotifyPause();
      } else {
        await api.spotifyPlay(panelDeviceId ? { device_id: panelDeviceId } : undefined);
      }
    });
  };

  const playHere = () => {
    void run(async () => {
      try {
        await sdkRef.current?.activateElement();
      } catch { /* gesture may already be consumed */ }
      const id = panelIdRef.current ?? panelDeviceId;
      if (!id) throw new Error('Panel-Gerät noch nicht bereit');
      await api.spotifyTransfer(id, true);
    });
  };

  const onVolume = (v: number) => {
    void run(async () => {
      await api.spotifyVolume(v);
      try {
        await sdkRef.current?.setVolume(v / 100);
      } catch { /* remote device */ }
    });
  };

  const doSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setActionError(null);
    try {
      const res = await api.spotifySearch(q);
      setTracks(res.tracks ?? []);
      setPlaylists(res.playlists ?? []);
      setTab('search');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Suche fehlgeschlagen');
    } finally {
      setSearching(false);
    }
  };

  if (!player) {
    return (
      <div className="rounded-2xl border bg-card p-4 animate-pulse space-y-3">
        <div className="h-4 bg-muted rounded w-24" />
        <div className="h-16 bg-muted rounded w-full" />
      </div>
    );
  }

  if (!player.connected) {
    return (
      <div className="rounded-2xl border bg-card p-4 flex items-center gap-3 text-muted-foreground">
        <Music2 className="h-8 w-8 opacity-30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Spotify nicht verbunden</p>
          <p className="text-xs">
            Premium-Konto in den{' '}
            <Link href="/settings?view=widgets" className="text-primary underline underline-offset-2">
              Widget-Einstellungen
            </Link>{' '}
            verknüpfen.
          </p>
        </div>
      </div>
    );
  }

  const item = player.item;
  const vol = player.volume_percent ?? 50;
  const mergedDevices = [...devices];
  if (panelDeviceId && !mergedDevices.some((d) => d.id === panelDeviceId)) {
    mergedDevices.unshift({
      id: panelDeviceId,
      name: 'SmartHome Panel',
      type: 'Computer',
      is_active: player.device?.id === panelDeviceId,
      volume_percent: vol,
    });
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Music2 className="h-3.5 w-3.5" />
          Spotify
        </p>
        <div className="flex gap-1">
          {(['now', 'search', 'queue'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'text-[10px] px-2 py-1 rounded-md font-medium',
                tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {t === 'now' ? 'Jetzt' : t === 'search' ? 'Suche' : 'Queue'}
            </button>
          ))}
        </div>
      </div>

      {(sdkError || actionError) && (
        <p className="text-xs text-destructive">{actionError ?? sdkError}</p>
      )}

      {tab === 'now' && (
        <>
          <div className="flex gap-3 items-center">
            {item?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image} alt="" className="h-16 w-16 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Music2 className="h-6 w-6 text-muted-foreground opacity-40" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{item?.name ?? 'Nichts spielt'}</p>
              <p className="text-xs text-muted-foreground truncate">
                {item?.artists?.join(', ') ?? '—'}
              </p>
              {item && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatMs(player.progress_ms ?? 0)} / {formatMs(item.duration_ms)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => api.spotifyPrevious())}
              aria-label="Vorheriger Titel"
            >
              <SkipBack className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              disabled={busy}
              onClick={togglePlay}
              aria-label={player.is_playing ? 'Pause' : 'Play'}
            >
              {player.is_playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => api.spotifyNext())}
              aria-label="Nächster Titel"
            >
              <SkipForward className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="range"
              min={0}
              max={100}
              value={vol}
              disabled={busy}
              onChange={(e) => onVolume(Number(e.target.value))}
              className="flex-1 accent-primary"
              aria-label="Lautstärke"
            />
            <span className="text-[10px] text-muted-foreground w-7 tabular-nums">{vol}%</span>
          </div>

          <div className="flex items-center gap-2">
            <Speaker className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              className="flex-1 text-xs rounded-lg border bg-background px-2 py-1.5"
              value={player.device?.id ?? ''}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                void run(() => api.spotifyTransfer(id, true));
              }}
              aria-label="Gerät"
            >
              {mergedDevices.length === 0 && <option value="">Kein Gerät</option>}
              {mergedDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.is_active ? ' ●' : ''}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !panelDeviceId}
              onClick={playHere}
            >
              Hier
            </Button>
          </div>
        </>
      )}

      {tab === 'search' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch();
              }}
              placeholder="Titel oder Playlist…"
              className="flex-1 text-sm rounded-lg border bg-background px-3 py-2"
            />
            <Button type="button" size="icon" disabled={searching} onClick={() => void doSearch()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {tracks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                {t.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.image} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{t.artists.join(', ')}</p>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => api.spotifyPlay({ uri: t.uri, device_id: panelDeviceId ?? undefined }))}
                  aria-label="Abspielen"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => api.spotifyAddToQueue(t.uri))}
                  aria-label="Zur Queue"
                >
                  <ListMusic className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {playlists.map((pl) => (
              <div key={pl.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                {pl.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pl.image} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{pl.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{pl.owner}</p>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => api.spotifyPlay({ uri: pl.uri, device_id: panelDeviceId ?? undefined }))}
                  aria-label="Playlist abspielen"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {tracks.length === 0 && playlists.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Suche starten</p>
            )}
          </div>
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Als Nächstes</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || queue.length === 0}
              onClick={() => void run(() => api.spotifyNext())}
            >
              Skip
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {queue.slice(0, 20).map((t, i) => (
              <div key={`${t.id}-${i}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <span className="text-[10px] text-muted-foreground w-4 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{t.artists.join(', ')}</p>
                </div>
              </div>
            ))}
            {queue.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Queue leer</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
