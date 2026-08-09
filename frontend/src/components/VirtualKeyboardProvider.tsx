'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { X } from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';

const TEXT_TYPES = new Set([
  'text', 'email', 'search', 'url', 'tel', 'password', 'number', '',
]);

type Layout = 'default' | 'shift' | 'numbers';

const LAYOUTS = {
  default: [
    'q w e r t z u i o p ü',
    'a s d f g h j k l ö ä',
    '{shift} y x c v b n m {bksp}',
    '{numbers} {space} {enter}',
  ],
  shift: [
    'Q W E R T Z U I O P Ü',
    'A S D F G H J K L Ö Ä',
    '{shift} Y X C V B N M {bksp}',
    '{numbers} {space} {enter}',
  ],
  numbers: [
    '1 2 3 4 5 6 7 8 9 0',
    '@ # $ _ & - + ( ) /',
    ". , : ; ! ? ' \" {bksp}",
    '{default} {space} {enter}',
  ],
};

const DISPLAY = {
  '{bksp}': '⌫',
  '{enter}': '↵',
  '{shift}': '⇧',
  '{space}': '   ',
  '{numbers}': '123',
  '{default}': 'ABC',
};

function writeToInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function defaultLayout(el: HTMLInputElement | HTMLTextAreaElement): Layout {
  if (el.type === 'tel' || el.type === 'number') return 'numbers';
  return 'default';
}

function insideKeyboard(node: EventTarget | null): boolean {
  return node instanceof Element && !!node.closest('[data-vk-root]');
}

/** Handy behält die native OS-Tastatur; Custom nur für Pi/Desktop-Touch. */
function shouldUseCustomKeyboard(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
  // Touch / grober Pointer (Pi-Touchscreen) oder aktiver Kiosk-Modus
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const kiosk =
    document.body.classList.contains('kiosk-active') ||
    localStorage.getItem('smarthome_kiosk') === 'true' ||
    new URLSearchParams(window.location.search).get('kiosk') === '1';
  return coarse || kiosk;
}

export default function VirtualKeyboardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>('default');
  const [mounted, setMounted] = useState(false);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<Layout>('default');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbRef = useRef<any>(null);
  const pinLock = usePinLockContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!open || !el) {
      document.documentElement.style.removeProperty('--vk-h');
      return;
    }
    const measure = () =>
      document.documentElement.style.setProperty('--vk-h', `${el.offsetHeight}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--vk-h');
    };
  }, [open]);

  const close = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      const orig = el.dataset.vkOrigInputmode ?? '';
      if (orig) el.inputMode = orig as HTMLInputElement['inputMode'];
      else el.removeAttribute('inputmode');
      delete el.dataset.vkOrigInputmode;
    }
    inputRef.current = null;
    setOpen(false);
    document.body.classList.remove('vk-open');
    document.documentElement.style.removeProperty('--vk-h');
  }, []);

  const openFor = useCallback((el: HTMLInputElement | HTMLTextAreaElement) => {
    if (!shouldUseCustomKeyboard()) return;

    if (inputRef.current === el) {
      kbRef.current?.setInput(el.value ?? '');
      return;
    }

    if (inputRef.current) {
      const prev = inputRef.current;
      const orig = prev.dataset.vkOrigInputmode ?? '';
      if (orig) prev.inputMode = orig as HTMLInputElement['inputMode'];
      else prev.removeAttribute('inputmode');
      delete prev.dataset.vkOrigInputmode;
    }

    // Native OSK unterdrücken (Pi), Custom-Tastatur nutzen
    el.dataset.vkOrigInputmode = el.getAttribute('inputmode') ?? '';
    el.setAttribute('inputmode', 'none');

    inputRef.current = el;
    const l = defaultLayout(el);
    layoutRef.current = l;
    setLayout(l);
    setOpen(true);
    document.body.classList.add('vk-open');

    requestAnimationFrame(() => {
      kbRef.current?.setInput(el.value ?? '');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (pinLock.locked || pinLock.screenOff) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (t.disabled || t.readOnly) return;
      if (t.dataset.noKeyboard === 'true') return;
      if (!TEXT_TYPES.has(t.type)) return;
      openFor(t);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [openFor, pinLock.locked, pinLock.screenOff]);

  // Tippen außerhalb von Tastatur + aktivem Input → schließen
  // Dialoge selbst schließen NICHT die Tastatur (Felder darin brauchen sie)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (insideKeyboard(t)) return;
      if (t === inputRef.current) return;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      // Klick in einen Dialog (Inhalt) — Tastatur offen lassen, solange Fokus im Input bleibt
      if (t instanceof Element && t.closest('[data-slot="dialog-content"]')) return;
      close();
    };
    // capture: nach Radix, aber wir schließen nur unsere Tastatur — Dialog bleibt via dialog.tsx
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) close();
  }, [pinLock.locked, pinLock.screenOff, close]);

  /*
   * React onTouchStart ist passiv → preventDefault wirkt nicht.
   * Ohne preventDefault stehlen synthetische mouse/pointer-Events den Fokus
   * und Radix wertet den Tap als Outside-Click.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !open) return;
    const handler = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.vk-close')) return;
      e.preventDefault();
    };
    el.addEventListener('touchstart', handler, { passive: false });
    return () => el.removeEventListener('touchstart', handler);
  }, [open]);

  const onKey = useCallback(
    (btn: string) => {
      if (btn === '{shift}') {
        const next: Layout = layoutRef.current === 'shift' ? 'default' : 'shift';
        layoutRef.current = next;
        setLayout(next);
        return;
      }
      if (btn === '{numbers}') {
        layoutRef.current = 'numbers';
        setLayout('numbers');
        return;
      }
      if (btn === '{default}') {
        layoutRef.current = 'default';
        setLayout('default');
        return;
      }

      const el = inputRef.current;
      if (!el) return;
      if (btn === '{enter}') {
        close();
        return;
      }

      const cur = el.value ?? '';
      const next =
        btn === '{bksp}' ? cur.slice(0, -1) : btn === '{space}' ? cur + ' ' : cur + btn;

      writeToInput(el, next);
      kbRef.current?.setInput(next);

      requestAnimationFrame(() => {
        if (inputRef.current && document.activeElement !== inputRef.current) {
          inputRef.current.focus({ preventScroll: true });
        }
      });

      if (layoutRef.current === 'shift') {
        layoutRef.current = 'default';
        setLayout('default');
      }
    },
    [close],
  );

  const kb =
    open && mounted
      ? createPortal(
          <div
            ref={wrapRef}
            className="vk-wrap"
            data-vk-root
            data-slot="virtual-keyboard"
            // Verhindert Fokus-Diebstahl auf Desktop-Pointer
            onMouseDown={e => e.preventDefault()}
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="vk-close"
              onMouseDown={e => {
                e.preventDefault();
                close();
              }}
              onClick={close}
              aria-label="Tastatur schließen"
            >
              <X size={18} />
            </button>
            <Keyboard
              keyboardRef={(r: unknown) => {
                kbRef.current = r;
              }}
              onKeyPress={onKey}
              layoutName={layout}
              layout={LAYOUTS}
              display={DISPLAY}
              theme="hg-theme-default vk-theme"
              useTouchEvents
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {children}
      {kb}
    </>
  );
}
