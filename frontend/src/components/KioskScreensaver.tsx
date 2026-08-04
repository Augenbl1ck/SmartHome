'use client';

import { useEffect, useState } from 'react';

const IDLE_MS = 5 * 60 * 1000; // 5 Minuten

export default function KioskScreensaver() {
  const [idle, setIdle] = useState(false);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      clearTimeout(timer);
      if (idle) setIdle(false);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Uhr nur aktualisieren wenn Bildschirmschoner aktiv
  useEffect(() => {
    if (!idle) return;
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      setDate(now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [idle]);

  if (!idle) return null;

  return (
    <div
      onClick={() => setIdle(false)}
      onTouchStart={() => setIdle(false)}
      className="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center cursor-pointer select-none"
    >
      {/* Große Uhr */}
      <p className="text-[clamp(80px,20vw,140px)] font-bold tabular-nums leading-none tracking-tight">
        {time}
      </p>
      <p className="text-xl text-muted-foreground mt-4">{date}</p>

      {/* Hinweis */}
      <p className="absolute bottom-12 text-sm text-muted-foreground/40">
        Tippen zum Entsperren
      </p>
    </div>
  );
}
