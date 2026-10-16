'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Zap } from 'lucide-react';
import { getEcho, onEchoReset } from '@/lib/echo';

/**
 * Läuft global im Hintergrund (via layout.tsx).
 * Empfängt AutomationFired-Events via Reverb und zeigt einen Toast.
 */
export default function AutomationNotifications() {
  useEffect(() => {
    let echo: ReturnType<typeof getEcho> | null = null;

    const bindEcho = () => {
      try { echo?.leaveChannel('automations'); } catch { /* alte Verbindung */ }
      echo = null;
      try {
        echo = getEcho();
        echo.channel('automations').listen('.automation.fired', (data: {
          name: string;
          summary: string;
        }) => {
          toast(data.name, {
            description: data.summary,
            icon: <Zap className="h-4 w-4 text-amber-500" />,
            duration: 5000,
          });
        });
      } catch (err) {
        echo = null;
        console.warn('[AutomationNotifications] Reverb nicht erreichbar', err);
      }
    };

    bindEcho();
    const offEcho = onEchoReset(bindEcho);

    return () => {
      offEcho();
      if (echo) echo.leaveChannel('automations');
    };
  }, []);

  return null;
}
