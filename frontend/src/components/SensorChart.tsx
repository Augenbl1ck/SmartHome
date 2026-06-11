'use client';

import { useEffect, useState } from 'react';
import { api, SensorHistory } from '@/lib/api';
import { DeviceType } from '@/lib/api';
import { TrendingDown, TrendingUp, Minus, Wind } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  deviceId: number;
  deviceType: DeviceType;
  currentValue: string;
}

const UNIT: Partial<Record<DeviceType, string>> = {
  sensor_temperature: '°C',
  sensor_humidity:    '%',
};

// Schwellwert für Lüftungsempfehlung
const HUMIDITY_HIGH = 65;
const TEMP_LOW      = 18;

/** Einfacher SVG-Sparkline aus numerischen Werten */
function Sparkline({ values, color, id }: { values: number[]; color: string; id: number }) {
  if (values.length < 2) return null;

  const W = 200, H = 48, PAD = 4;
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaPoints = [
    `${PAD},${H - PAD}`,
    ...points,
    `${(W - PAD).toFixed(1)},${H - PAD}`,
  ].join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#sg-${id})`} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SensorChart({ deviceId, deviceType, currentValue }: Props) {
  const [history, setHistory]   = useState<SensorHistory | null>(null);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(false);

  const unit = UNIT[deviceType] ?? '';
  const numVal = parseFloat(currentValue);
  const isBad =
    (deviceType === 'sensor_humidity' && numVal >= HUMIDITY_HIGH) ||
    (deviceType === 'sensor_temperature' && numVal < TEMP_LOW);

  useEffect(() => {
    api.getSensorHistory(deviceId, 24)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [deviceId]);

  const values = history?.readings.map(r => r.value) ?? [];
  const last2  = values.slice(-2);
  const trend  = last2.length === 2
    ? last2[1] > last2[0] ? 'up' : last2[1] < last2[0] ? 'down' : 'flat'
    : 'flat';

  const color = deviceType === 'sensor_temperature' ? '#f97316' : '#3b82f6';

  return (
    <div className="mt-2 space-y-1">
      {/* Lüftungs- / Alarm-Empfehlung */}
      {!isNaN(numVal) && isBad && (
        <div className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
          deviceType === 'sensor_humidity'
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
            : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
        )}>
          <Wind className="h-3 w-3 shrink-0" />
          {deviceType === 'sensor_humidity'
            ? 'Luftfeuchtigkeit hoch → Lüften empfohlen'
            : `Temperatur unter ${TEMP_LOW}°C → Heizung prüfen`}
        </div>
      )}

      {/* Toggle für Graph */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="cursor-pointer w-full text-left flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {trend === 'up'   && <TrendingUp   className="h-3 w-3 text-orange-500" />}
        {trend === 'down' && <TrendingDown className="h-3 w-3 text-blue-500" />}
        {trend === 'flat' && <Minus        className="h-3 w-3" />}
        {loading ? 'Lade Verlauf…' : `24h-Verlauf ${expanded ? '▲' : '▼'}`}
        {history && (
          <span className="ml-auto font-mono">
            ↓ {history.min}{unit}  ↑ {history.max}{unit}
          </span>
        )}
      </button>

      {expanded && !loading && values.length > 1 && (
        <div className="space-y-1">
          <Sparkline values={values} color={color} id={deviceId} />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono px-0.5">
            <span>vor 24h</span>
            <span>jetzt</span>
          </div>
        </div>
      )}

      {expanded && !loading && values.length === 0 && (
        <p className="text-xs text-muted-foreground">Noch keine Verlaufsdaten.</p>
      )}
    </div>
  );
}
