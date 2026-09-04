'use client';

import { useEffect } from 'react';
import { useSmartHomeStore } from '@/store/smarthome';
import type { BootstrapPayload } from '@/lib/api';
import { bootstrapHasContent, loadBootstrapSnapshot, saveBootstrapSnapshot } from '@/lib/bootstrap-snapshot';

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
    const snap = loadBootstrapSnapshot();
    if (snap) hydrate(snap);
    if (initial && bootstrapHasContent(initial)) {
      hydrate(initial);
      saveBootstrapSnapshot({
        rooms: initial.rooms ?? snap?.rooms ?? [],
        devices: initial.devices ?? snap?.devices ?? [],
        scenes: initial.scenes ?? snap?.scenes ?? [],
        weather: initial.weather ?? snap?.weather,
        transit: initial.transit ?? snap?.transit,
        energy: initial.energy ?? snap?.energy,
        calendar: initial.calendar ?? snap?.calendar,
      });
    }
    void fetchBootstrap();
  }, [hydrate, fetchBootstrap, initial]);

  return children;
}
