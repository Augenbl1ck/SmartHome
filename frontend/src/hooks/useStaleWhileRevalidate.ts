'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const memory = new Map<string, unknown>();

export function peekWidgetCache<T>(key: string): T | null {
  return (memory.get(key) as T | undefined) ?? null;
}

export function useStaleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  intervalMs: number,
  initial?: T | null,
): { data: T | null; loading: boolean; error: string | null } {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const seeded = initial ?? peekWidgetCache<T>(key);
  const [data, setData] = useState<T | null>(seeded);
  const [loading, setLoading] = useState(seeded == null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetcherRef.current();
      memory.set(key, res);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (initial != null) {
      memory.set(key, initial);
      setData(initial);
      setLoading(false);
    }
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [key, intervalMs, load, initial]);

  return { data, loading, error };
}
