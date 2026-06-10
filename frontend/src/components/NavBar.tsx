'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Zap, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/',            icon: Home,     label: 'Home' },
  { href: '/automations', icon: Zap,      label: 'Automationen' },
  { href: '/settings',    icon: Settings, label: 'Einstellungen' },
] as const;

export default function NavBar() {
  const path = usePathname();

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href);

  return (
    <>
      {/* ── Desktop top bar ─────────────────────────────────────────── */}
      <header className="hidden md:flex items-center gap-2 border-b px-6 h-14 bg-background/95 backdrop-blur sticky top-0 z-40">
        <span className="font-bold text-lg mr-4 tracking-tight">🏠 SmartHome</span>
        <nav className="flex gap-1">
          {NAV.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                isActive(href)
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ── Mobile top bar ──────────────────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-40 flex items-center h-14 px-4 bg-background/95 backdrop-blur border-b">
        <span className="font-semibold text-base tracking-tight">🏠 SmartHome</span>
      </header>

      {/* ── Mobile bottom nav ───────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t bg-background">
        <div className="flex">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-3 min-h-[60px]',
                  'text-xs font-medium transition-colors cursor-pointer'
                )}
              >
                <div className={cn(
                  'flex items-center justify-center rounded-full w-10 h-7 transition-colors',
                  active ? 'bg-primary/10' : ''
                )}>
                  <Icon className={cn(
                    'h-5 w-5 transition-all',
                    active ? 'text-primary stroke-[2.5px]' : 'text-muted-foreground'
                  )} />
                </div>
                <span className={cn(
                  'transition-colors',
                  active ? 'text-primary font-semibold' : 'text-muted-foreground'
                )}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
