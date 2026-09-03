'use client';

import { useEffect, useState } from 'react';
import { api, Device } from '@/lib/api';
import { deviceDayTempRange, deviceTemperature } from '@/lib/devices';

interface Props {
  device: Device;
}

export default function SensorDayStats({ device }: Props) {
  const [logged, setLogged] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getSensorHistory(device.id, 24, { today: true })
      .then(h => {
        if (cancelled || h.min == null || h.max == null) return;
        setLogged({ min: h.min, max: h.max });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [device.id]);

  const live = deviceDayTempRange(device, deviceTemperature(device));
  let min = live.min;
  let max = live.max;
  if (logged) {
    min = min == null ? logged.min : Math.min(min, logged.min);
    max = max == null ? logged.max : Math.max(max, logged.max);
  }

  if (min == null || max == null) return null;

  return (
    <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
      Min {min.toFixed(1)}° · Max {max.toFixed(1)}°
    </p>
  );
}
