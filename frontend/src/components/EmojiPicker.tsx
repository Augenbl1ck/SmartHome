'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

// Smarthome-relevante Emojis, nach Kategorie
const EMOJI_GROUPS = [
  {
    label: 'Licht',
    emojis: ['💡', '🔦', '🕯️', '🪔', '🌟', '✨', '🌈', '🔆'],
  },
  {
    label: 'Strom & Heizung',
    emojis: ['🔌', '⚡', '🔋', '🌡️', '🔥', '❄️', '♨️', '🌬️'],
  },
  {
    label: 'Zuhause',
    emojis: ['🏠', '🚪', '🪟', '🛋️', '🛏️', '🍳', '🚿', '🛁', '🪴', '🏡'],
  },
  {
    label: 'Geräte',
    emojis: ['📺', '🖥️', '💻', '📱', '🎮', '🎵', '🎛️', '📻', '🖨️', '⌨️'],
  },
  {
    label: 'Sicherheit',
    emojis: ['🔒', '🔓', '🔑', '🚨', '🚪', '👁️', '📹', '🔔', '🚫', '✅'],
  },
  {
    label: 'Sensoren',
    emojis: ['💧', '🌊', '💨', '🌫️', '☀️', '🌙', '⭐', '🌤️', '🌡️', '📡'],
  },
  {
    label: 'Sonstiges',
    emojis: ['⚙️', '🔧', '🛠️', '🎯', '🎨', '🚗', '🌿', '🐾', '🎬', '📦'],
  },
] as const;

interface Props {
  value: string;
  onChange: (emoji: string) => void;
}

export default function EmojiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Schließen wenn außerhalb geklickt
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Vorschau-Button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm w-full transition-colors',
          'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
          open && 'ring-2 ring-ring'
        )}
      >
        <span className="text-2xl leading-none w-8 text-center">
          {value || '➕'}
        </span>
        <span className="flex-1 text-left text-muted-foreground text-xs">
          {value ? 'Emoji ändern' : 'Emoji wählen (optional)'}
        </span>
        {value && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="text-xs text-muted-foreground hover:text-foreground px-1"
          >
            ✕
          </span>
        )}
      </button>

      {/* Dropdown-Grid */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border bg-popover shadow-lg overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-2 space-y-3">
            {EMOJI_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
                  {group.label}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {group.emojis.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => { onChange(emoji); setOpen(false); }}
                      className={cn(
                        'h-9 w-full flex items-center justify-center rounded-lg text-xl transition-colors',
                        'hover:bg-accent active:scale-95',
                        value === emoji && 'bg-primary/15 ring-1 ring-primary'
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
