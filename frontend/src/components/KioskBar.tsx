'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Settings } from 'lucide-react';
import { api, Room } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function KioskBar() {
  const path = usePathname();
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    api.getRooms().then(setRooms).catch(() => {});
  }, []);

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path.startsWith(href);

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 h-20 bg-background/95 backdrop-blur border-t flex items-stretch">
      {/* Home */}
      <Link
        href="/"
        className={cn(
          'flex flex-col items-center justify-center gap-1 min-w-[72px] px-3 text-xs font-medium transition-colors',
          isActive('/') ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <div className={cn(
          'h-9 w-9 rounded-xl flex items-center justify-center transition-colors',
          isActive('/') ? 'bg-primary/10' : 'hover:bg-accent'
        )}>
          <Home className="h-5 w-5" />
        </div>
        <span>Home</span>
      </Link>

      {/* Räume */}
      <div className="flex-1 flex items-stretch overflow-x-auto scrollbar-none">
        {rooms.map(room => (
          <Link
            key={room.id}
            href={`/rooms/${room.id}`}
            className={cn(
              'flex flex-col items-center justify-center gap-1 min-w-[80px] px-2 text-xs font-medium transition-colors',
              isActive(`/rooms/${room.id}`) ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <div className={cn(
              'h-9 w-9 rounded-xl flex items-center justify-center text-xl transition-colors',
              isActive(`/rooms/${room.id}`) ? 'bg-primary/10' : 'hover:bg-accent'
            )}>
              {room.icon ?? '🏠'}
            </div>
            <span className="truncate max-w-[72px] text-center leading-tight">
              {room.name}
            </span>
          </Link>
        ))}
      </div>

      {/* Einstellungen */}
      <Link
        href="/settings"
        className={cn(
          'flex flex-col items-center justify-center gap-1 min-w-[72px] px-3 text-xs font-medium transition-colors',
          isActive('/settings') ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <div className={cn(
          'h-9 w-9 rounded-xl flex items-center justify-center transition-colors',
          isActive('/settings') ? 'bg-primary/10' : 'hover:bg-accent'
        )}>
          <Settings className="h-5 w-5" />
        </div>
        <span>Einst.</span>
      </Link>
    </nav>
  );
}
