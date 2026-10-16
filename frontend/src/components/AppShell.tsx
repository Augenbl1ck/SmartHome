'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, Settings, LockKeyhole, MonitorOff, LayoutGrid, Zap, Sun,
  CalendarDays, Clapperboard, X,
} from 'lucide-react';
import { api, Room } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePinLockContext } from '@/components/PinLockProvider';

const MORE_LINKS = [
  { href: '/scenes', label: 'Szenen', icon: Clapperboard },
  { href: '/automations', label: 'Automationen', icon: Zap },
  { href: '/energy', label: 'Energie', icon: Zap },
  { href: '/calendar', label: 'Kalender', icon: CalendarDays },
  { href: '/weather', label: 'Wetter', icon: Sun },
  { href: '/settings', label: 'Einstellungen', icon: Settings },
];

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { enabled, lock, sleepScreen } = usePinLockContext();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [mounted, setMounted] = useState(false);
  const [sheet, setSheet] = useState<'rooms' | 'more' | null>(null);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    const load = async () => {
      try {
        const list = await api.getRooms();
        if (!cancelled) setRooms(list);
      } catch { /* Leiste bleibt ohne Räume nutzbar */ }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 3 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => { setSheet(null); }, [path]);

  return (
    <div className="flex flex-1 min-h-0 w-full">
      <aside data-slot="app-side-nav" className="app-side-nav">
        <Link href="/" className={cn('nav-item', isActive(path, '/') && 'nav-item-active')} aria-label="Übersicht">
          <Home className="h-5 w-5 shrink-0" />
          <span className="nav-label">Übersicht</span>
        </Link>

        <div className="nav-scroll">
          {rooms.map((room) => (
            <Link
              key={room.id}
              href={`/rooms/${room.id}`}
              prefetch
              className={cn('nav-item', isActive(path, `/rooms/${room.id}`) && 'nav-item-active')}
              aria-label={room.name}
            >
              <span className="nav-emoji">{room.icon ?? '🏠'}</span>
              <span className="nav-label">{room.name}</span>
            </Link>
          ))}
          {MORE_LINKS.filter((l) => l.href !== '/settings').map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('nav-item', isActive(path, item.href) && 'nav-item-active')}
                aria-label={item.label}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="nav-label">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="nav-footer">
          {mounted && (
            <button type="button" onClick={sleepScreen} className="nav-item" aria-label="Display aus">
              <MonitorOff className="h-5 w-5 shrink-0" />
              <span className="nav-label">Display</span>
            </button>
          )}
          {mounted && enabled && (
            <button type="button" onClick={lock} className="nav-item" aria-label="Sperren">
              <LockKeyhole className="h-5 w-5 shrink-0" />
              <span className="nav-label">Sperren</span>
            </button>
          )}
          <Link href="/settings" className={cn('nav-item', isActive(path, '/settings') && 'nav-item-active')} aria-label="Einstellungen">
            <Settings className="h-5 w-5 shrink-0" />
            <span className="nav-label">Einstellungen</span>
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto w-full p-4 pb-24 md:pb-4 xl:p-6">
        {children}
      </main>

      <nav data-slot="app-bottom-nav" className="app-bottom-nav">
        <Link href="/" className={cn('bottom-item', path === '/' && 'bottom-item-active')}>
          <Home className="h-5 w-5" />
          <span>Übersicht</span>
        </Link>
        <button
          type="button"
          className={cn('bottom-item', sheet === 'rooms' && 'bottom-item-active')}
          onClick={() => setSheet((s) => (s === 'rooms' ? null : 'rooms'))}
        >
          <LayoutGrid className="h-5 w-5" />
          <span>Räume</span>
        </button>
        <button
          type="button"
          className={cn('bottom-item', sheet === 'more' && 'bottom-item-active')}
          onClick={() => setSheet((s) => (s === 'more' ? null : 'more'))}
        >
          <Settings className="h-5 w-5" />
          <span>Mehr</span>
        </button>
      </nav>

      {sheet && (
        <div data-slot="app-sheet" className="app-sheet md:hidden" role="dialog" aria-label={sheet === 'rooms' ? 'Räume' : 'Mehr'}>
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold">{sheet === 'rooms' ? 'Räume' : 'Mehr'}</p>
            <button type="button" className="h-10 w-10 rounded-xl flex items-center justify-center hover:bg-accent" onClick={() => setSheet(null)} aria-label="Schließen">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sheet === 'rooms' && rooms.map((room) => (
              <Link key={room.id} href={`/rooms/${room.id}`} className="sheet-link">
                <span className="text-2xl">{room.icon ?? '🏠'}</span>
                <span className="text-sm font-medium truncate">{room.name}</span>
              </Link>
            ))}
            {sheet === 'rooms' && rooms.length === 0 && (
              <p className="col-span-2 text-sm text-muted-foreground py-6 text-center">Noch keine Räume.</p>
            )}
            {sheet === 'more' && MORE_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="sheet-link">
                  <Icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
            {sheet === 'more' && mounted && (
              <button type="button" className="sheet-link" onClick={sleepScreen}>
                <MonitorOff className="h-5 w-5" />
                <span className="text-sm font-medium">Display aus</span>
              </button>
            )}
            {sheet === 'more' && mounted && enabled && (
              <button type="button" className="sheet-link" onClick={lock}>
                <LockKeyhole className="h-5 w-5" />
                <span className="text-sm font-medium">Sperren</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
