'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { X } from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';

/* ── Welche Input-Typen öffnen die Tastatur ────────────────────────── */
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
  '{bksp}':    '⌫',
  '{enter}':   '↵',
  '{shift}':   '⇧',
  '{space}':   '   ',
  '{numbers}': '123',
  '{default}': 'ABC',
};

/* ── React-kontrolliertes Input nativ beschreiben ──────────────────── */
function writeToInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = el.tagName === 'TEXTAREA'
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

/* ── Hilfsfunktion: Ist der Knoten Teil des Tastatur-Containers ──────── */
function insideKeyboard(node: EventTarget | null): boolean {
  return node instanceof Element && !!node.closest('.vk-wrap');
}

/* ════════════════════════════════════════════════════════════════════ */
export default function VirtualKeyboardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open,   setOpen]   = useState(false);
  const [layout, setLayout] = useState<Layout>('default');
  const [ssr,    setSsr]    = useState(true);

  const inputRef  = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<Layout>('default');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbRef     = useRef<any>(null);
  const pinLock   = usePinLockContext();

  useEffect(() => { setSsr(false); }, []);

  /* CSS-Variable für Tastatur-Höhe (damit Dialog darüber positioniert werden kann) */
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
    return () => ro.disconnect();
  }, [open]);

  /* ── Tastatur schließen ─────────────────────────────────────────── */
  const close = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      /* inputMode zurücksetzen */
      const orig = el.dataset.vkOrigInputmode ?? '';
      el.inputMode = orig;
      delete el.dataset.vkOrigInputmode;
    }
    inputRef.current = null;
    setOpen(false);
    document.body.classList.remove('vk-open');
    document.documentElement.style.removeProperty('--vk-h');
  }, []);

  /* ── Tastatur öffnen ────────────────────────────────────────────── */
  const openFor = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement) => {
      /* Bereits dieses Feld aktiv → nur Sync */
      if (inputRef.current === el) {
        kbRef.current?.setInput(el.value ?? '');
        return;
      }

      /* Vorheriges Feld aufräumen */
      if (inputRef.current) {
        const prev = inputRef.current;
        prev.inputMode = prev.dataset.vkOrigInputmode ?? '';
        delete prev.dataset.vkOrigInputmode;
      }

      /* Native Tastatur auf dem Pi unterdrücken */
      el.dataset.vkOrigInputmode = el.inputMode ?? '';
      el.inputMode = 'none';

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
    },
    [],
  );

  /* ── Fokus auf Text-Input → Tastatur öffnen ─────────────────────── */
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

  /* ── Tippen außerhalb von Tastatur + Inputs → schließen ─────────── */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (insideKeyboard(t)) return;
      if (t === inputRef.current) return;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  /* ── PIN-Sperre → Tastatur schließen ───────────────────────────── */
  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) close();
  }, [pinLock.locked, pinLock.screenOff, close]);

  /*
   * ── KRITISCH: Nicht-passiver nativer touchstart-Listener ───────────
   *
   * React registriert onTouchStart als PASSIVEN Listener (passive: true).
   * Passive Listener ignorieren e.preventDefault() — der Browser erzeugt
   * trotzdem die synthetischen pointer/mouse-Events, die dem Input den
   * Fokus stehlen.
   *
   * Lösung: nativer Listener mit { passive: false } direkt auf dem DOM-
   * Element. Nur so kann preventDefault() den Fokus-Diebstahl verhindern.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !open) return;
    const handler = (e: TouchEvent) => {
      // X-Button ist eigenständig — rest prevent
      const target = e.target as HTMLElement | null;
      if (target?.classList.contains('vk-close') || target?.closest('.vk-close')) return;
      e.preventDefault();
    };
    el.addEventListener('touchstart', handler, { passive: false });
    return () => el.removeEventListener('touchstart', handler);
  }, [open]);

  /* ── Tastendruck ─────────────────────────────────────────────────── */
  const onKey = useCallback(
    (btn: string) => {
      /* Layout-Umschalter */
      if (btn === '{shift}') {
        const next: Layout = layoutRef.current === 'shift' ? 'default' : 'shift';
        layoutRef.current = next;
        setLayout(next);
        return;
      }
      if (btn === '{numbers}') { layoutRef.current = 'numbers'; setLayout('numbers'); return; }
      if (btn === '{default}') { layoutRef.current = 'default'; setLayout('default'); return; }

      const el = inputRef.current;
      if (!el) return;

      if (btn === '{enter}') { close(); return; }

      const cur = el.value ?? '';
      const next =
        btn === '{bksp}'  ? cur.slice(0, -1) :
        btn === '{space}' ? cur + ' ' :
        cur + btn;

      writeToInput(el, next);
      kbRef.current?.setInput(next);

      /*
       * Fokus nach dem Tastendruck zurück auf das Input-Feld.
       * Backup falls trotzdem ein Event den Fokus gestohlen hat.
       */
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

  /* ── Tastatur-DOM ───────────────────────────────────────────────── */
  const kb =
    open && !ssr
      ? createPortal(
          <div
            ref={wrapRef}
            className="vk-wrap"
            /* Desktop: mousedown verhindert Fokus-Diebstahl */
            onMouseDown={e => e.preventDefault()}
            /* Touch: wird von nicht-passivem nativen Listener behandelt (s.u.) */
          >
            <button
              type="button"
              className="vk-close"
              onMouseDown={e => { e.preventDefault(); close(); }}
              onClick={close}
              aria-label="Tastatur schließen"
            >
              <X size={18} />
            </button>
            <Keyboard
              keyboardRef={(r: unknown) => { kbRef.current = r; }}
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
