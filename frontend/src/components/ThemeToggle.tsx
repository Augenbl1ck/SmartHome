'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { ensurePersonalProfile, isAndroidApp, rememberPersonal } from '@/lib/app-personal';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  localStorage.setItem('smarthome_theme', theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    const stored = (localStorage.getItem('smarthome_theme') as Theme) ?? 'system';
    setThemeState(stored);
    applyTheme(stored);

    let cancelled = false;
    (async () => {
      const personal = await ensurePersonalProfile();
      if (cancelled) return;
      if (personal) {
        const own = (localStorage.getItem('smarthome_theme') as Theme) || 'system';
        setThemeState(own);
        applyTheme(own);
        return;
      }
      try {
        const s = await api.getPanelSettings();
        if (cancelled) return;
        const remote = s.theme;
        if (remote === 'light' || remote === 'dark' || remote === 'system') {
          setThemeState(remote);
          applyTheme(remote);
        } else if (stored && stored !== 'system') {
          await api.updatePanelSettings({ theme: stored });
        }
      } catch { /* local cache */ }
    })();

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if ((localStorage.getItem('smarthome_theme') ?? 'system') === 'system') {
        applyTheme('system');
      }
    };
    mq.addEventListener('change', onChange);
    return () => {
      cancelled = true;
      mq.removeEventListener('change', onChange);
    };
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    if (isAndroidApp()) {
      rememberPersonal({ theme: t });
      return;
    }
    void api.updatePanelSettings({ theme: t }).catch(() => {});
  };

  return { theme, setTheme };
}

export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-8 w-8" />;

  const cycle = () => {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  };

  return (
    <button
      onClick={cycle}
      title={`Theme: ${theme}`}
      className={`cursor-pointer h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${className ?? ''}`}
    >
      {theme === 'dark'   ? <Moon className="h-4 w-4" />   : <Sun className="h-4 w-4" />}
    </button>
  );
}
