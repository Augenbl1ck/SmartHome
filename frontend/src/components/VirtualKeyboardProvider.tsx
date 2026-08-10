'use client';

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';

const TEXT_TYPES = new Set([
  'text', 'email', 'search', 'url', 'tel', 'password', 'number', '',
]);

type Layout = 'default' | 'shift' | 'numbers';

const LAYOUTS: Record<Layout, string[][]> = {
  default: [
    ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
    ['{shift}', 'y', 'x', 'c', 'v', 'b', 'n', 'm', '{bksp}'],
    ['{numbers}', '{space}', '{enter}'],
  ],
  shift: [
    ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
    ['{shift}', 'Y', 'X', 'C', 'V', 'B', 'N', 'M', '{bksp}'],
    ['{numbers}', '{space}', '{enter}'],
  ],
  numbers: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '_', '&', '-', '+', '(', ')', '/'],
    ['.', ',', ':', ';', '!', '?', "'", '"', '{bksp}'],
    ['{default}', '{space}', '{enter}'],
  ],
};

const LABELS: Record<string, string> = {
  '{bksp}': '⌫',
  '{enter}': '↵',
  '{shift}': '⇧',
  '{space}': ' ',
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

function keyClass(key: string): string {
  if (key === '{space}') return 'vk-key vk-key-space';
  if (
    key === '{bksp}' ||
    key === '{shift}' ||
    key === '{enter}' ||
    key === '{numbers}' ||
    key === '{default}'
  ) {
    return 'vk-key vk-key-fn';
  }
  return 'vk-key';
}

function scrollInputIntoView(el: HTMLElement) {
  const kbH =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--vk-h'),
    ) || 240;
  const pad = 16;
  const visibleBottom = window.innerHeight - kbH - pad;
  const rect = el.getBoundingClientRect();

  // In Dialogen nur den Dialog-Inhalt scrollen — nicht die ganze Seite
  const dialog = el.closest('[data-slot="dialog-content"]');
  if (dialog instanceof HTMLElement) {
    if (rect.bottom > visibleBottom) {
      dialog.scrollBy({ top: rect.bottom - visibleBottom + pad, behavior: 'smooth' });
    } else if (rect.top < dialog.getBoundingClientRect().top + pad) {
      dialog.scrollBy({
        top: rect.top - dialog.getBoundingClientRect().top - pad,
        behavior: 'smooth',
      });
    }
    return;
  }

  if (rect.bottom > visibleBottom || rect.top < pad) {
    const delta = rect.top - (visibleBottom + pad) / 2;
    window.scrollBy({ top: delta, behavior: 'smooth' });
  }
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
    if (inputRef.current === el && document.body.classList.contains('vk-open')) {
      return;
    }

    if (inputRef.current && inputRef.current !== el) restoreInputMode(inputRef.current);

    el.dataset.vkOrigInputmode = el.getAttribute('inputmode') ?? '';
    el.setAttribute('inputmode', 'none');

    inputRef.current = el;
    const l = defaultLayout(el);
    layoutRef.current = l;
    setLayout(l);
    setOpen(true);
    document.body.classList.add('vk-open');
    document.documentElement.style.setProperty('--vk-h', '240px');

    // Nach Layout der Tastatur zum Feld scrollen
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollInputIntoView(el));
    });
  }, []);

  const press = useCallback(
    (key: string) => {
      if (key === '{shift}') {
        const next: Layout = layoutRef.current === 'shift' ? 'default' : 'shift';
        layoutRef.current = next;
        setLayout(next);
        return;
      }
      if (key === '{numbers}') {
        layoutRef.current = 'numbers';
        setLayout('numbers');
        return;
      }
      if (key === '{default}') {
        layoutRef.current = 'default';
        setLayout('default');
        return;
      }

      const el = inputRef.current;
      if (!el) return;
      if (key === '{enter}') {
        close();
        return;
      }

      const cur = el.value ?? '';
      const next =
        key === '{bksp}' ? cur.slice(0, -1) : key === '{space}' ? cur + ' ' : cur + key;

      writeToInput(el, next);

      if (layoutRef.current === 'shift') {
        layoutRef.current = 'default';
        setLayout('default');
      }
    },
    [close],
  );

  /*
   * Nur bei echtem Tippen/Klick auf ein Feld öffnen — nicht bei focusin.
   * Sonst öffnet Radix-Dialog-Autofokus / Seitenfokus die Tastatur von allein.
   */
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (pinLock.locked || pinLock.screenOff) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (t.disabled || t.readOnly) return;
      if (t.dataset.noKeyboard === 'true') return;
      if (!TEXT_TYPES.has(t.type)) return;
      openFor(t);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [openFor, pinLock.locked, pinLock.screenOff]);

  /* Außen tippen → schließen (nicht bei Dialog / Tastatur-Zone) */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest('[data-vk-root]')) return;
      if (t === inputRef.current) return;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (document.querySelector('[data-slot="dialog-overlay"]')) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      const el = inputRef.current;
      if (!el || !el.isConnected) close();
    }, 200);
    return () => window.clearInterval(id);
  }, [open, close]);

  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) close();
  }, [pinLock.locked, pinLock.screenOff, close]);

  // Nach Tastatur-Höhenmessung nochmal scrollen (Dialog/Feld sichtbar halten)
  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const el = inputRef.current;
    const t = window.setTimeout(() => scrollInputIntoView(el), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  const rows = LAYOUTS[layout];

  const kb =
    open && mounted
      ? createPortal(
          <div
            ref={wrapRef}
            className="vk-wrap"
            data-vk-root
            data-slot="virtual-keyboard"
          >
            <div className="vk-toolbar">
              <button
                type="button"
                className="vk-close"
                aria-label="Tastatur schließen"
                onPointerDown={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="vk-board">
              {rows.map((row, ri) => (
                <div key={ri} className="vk-row">
                  {row.map(key => (
                    <button
                      key={`${layout}-${ri}-${key}`}
                      type="button"
                      className={keyClass(key)}
                      data-vk-key={key}
                      onPointerDown={e => {
                        /*
                         * Auf Touch unterdrückt preventDefault oft das spätere click.
                         * Deshalb Tippen hier direkt auf pointerdown ausführen.
                         */
                        e.preventDefault();
                        e.stopPropagation();
                        press(key);
                      }}
                    >
                      {LABELS[key] ?? key}
                    </button>
                  ))}
                </div>
              ))}
            </div>
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
