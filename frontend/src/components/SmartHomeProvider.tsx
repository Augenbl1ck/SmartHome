'use client';

import { useEffect } from 'react';
import { useSmartHomeStore } from '@/store/smarthome';
import type { BootstrapPayload } from '@/lib/api';

export default function SmartHomeProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial?: Partial<BootstrapPayload>;
}) {
  const hydrate = useSmartHomeStore((s) => s.hydrate);
  const fetchBootstrap = useSmartHomeStore((s) => s.fetchBootstrap);

  useEffect(() => {
    if (initial && (initial.rooms || initial.devices || initial.scenes)) {
      hydrate(initial);
    }
  }, [hydrate, initial]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!useSmartHomeStore.getState().hydrated) void fetchBootstrap();
    }, 0);
    return () => window.clearTimeout(t);
  }, [fetchBootstrap]);

  return children;
}
