'use client';

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
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
  const mode = el.getAttribute('inputmode');
  if (mode === 'numeric' || mode === 'decimal') return 'numbers';
  return 'default';
}

function insideKeyboard(node: EventTarget | null): boolean {
  return node instanceof Element && !!node.closest('[data-vk-root]');
}

function dialogIsOpen(): boolean {
  return !!document.querySelector('[data-slot="dialog-overlay"]');
}

function inKeyboardZone(clientY: number): boolean {
  const kb = document.querySelector('[data-vk-root]');
  if (kb instanceof HTMLElement) {
    return clientY >= kb.getBoundingClientRect().top - 4;
  }
  const h = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--vk-h'),
  );
  const fallback = Number.isFinite(h) ? h : 240;
  return clientY >= window.innerHeight - fallback;
}

/** Handy/Tablet: native OS-Tastatur. Sonst (Pi-Kiosk, Desktop) Custom. */
function shouldUseCustomKeyboard(): boolean {
  if (typeof window === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return false;
  return true;
}

function restoreInputMode(el: HTMLInputElement | HTMLTextAreaElement) {
  const orig = el.dataset.vkOrigInputmode;
  if (orig === undefined) return;
  if (orig) el.setAttribute('inputmode', orig);
  else el.removeAttribute('inputmode');
  delete el.dataset.vkOrigInputmode;
}

function buttonFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const btn = target.closest('[data-skbtn]');
  if (!(btn instanceof HTMLElement)) return null;
  return btn.getAttribute('data-skbtn');
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

  useLayoutEffect(() => {
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
    if (el) restoreInputMode(el);
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

    if (inputRef.current) restoreInputMode(inputRef.current);

    el.dataset.vkOrigInputmode = el.getAttribute('inputmode') ?? '';
    el.setAttribute('inputmode', 'none');

    inputRef.current = el;
    const l = defaultLayout(el);
    layoutRef.current = l;
    setLayout(l);
    setOpen(true);
    document.body.classList.add('vk-open');
    document.documentElement.style.setProperty('--vk-h', '240px');

    requestAnimationFrame(() => {
      kbRef.current?.setInput(el.value ?? '');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (insideKeyboard(t)) return;
      if (inKeyboardZone(e.clientY)) return;
      if (t === inputRef.current) return;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (dialogIsOpen()) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const el = inputRef.current;
      if (!el || !el.isConnected) close();
    };
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [open, close]);

  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) close();
  }, [pinLock.locked, pinLock.screenOff, close]);

  /*
   * Eigenes Pointer-Handling als Backup:
   * - preventDefault verhindert Fokus-Diebstahl
   * - data-skbtn → onKey, unabhängig von react-simple-keyboard Touch-Bugs
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !open) return;

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.vk-close')) return;
      // Fokus bleibt auf dem Input
      e.preventDefault();
      const btn = buttonFromEvent(e.target);
      if (btn) onKey(btn);
    };

    el.addEventListener('pointerdown', onPointerDown);
    return () => el.removeEventListener('pointerdown', onPointerDown);
  }, [open, onKey]);

  const kb =
    open && mounted
      ? createPortal(
          <div
            ref={wrapRef}
            className="vk-wrap"
            data-vk-root
            data-slot="virtual-keyboard"
          >
            <button
              type="button"
              className="vk-close"
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                close();
              }}
              aria-label="Tastatur schließen"
            >
              <X size={18} />
            </button>
            <Keyboard
              keyboardRef={(r: unknown) => {
                kbRef.current = r;
              }}
              layoutName={layout}
              layout={LAYOUTS}
              display={DISPLAY}
              theme="hg-theme-default vk-theme"
              // Key-Events kommen vom eigenen pointerdown-Handler oben
              onKeyPress={() => {}}
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
