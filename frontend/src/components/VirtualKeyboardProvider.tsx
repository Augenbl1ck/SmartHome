'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { X } from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';

const TEXT_INPUT_TYPES = new Set([
  'text', 'email', 'search', 'url', 'tel', 'password', 'number', '',
]);

type LayoutName = 'default' | 'shift' | 'numbers';

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
  '{space}':   ' ',
  '{numbers}': '123',
  '{default}': 'ABC',
};

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function defaultLayoutFor(el: HTMLInputElement | HTMLTextAreaElement): LayoutName {
  if (el.type === 'tel' || el.type === 'number') return 'numbers';
  if (el.getAttribute('inputmode') === 'numeric') return 'numbers';
  return 'default';
}

function isInsideKeyboard(node: Node | null): boolean {
  if (!node || !(node instanceof HTMLElement)) return false;
  return !!node.closest('.vk-root');
}

export default function VirtualKeyboardProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible]     = useState(false);
  const [mounted, setMounted]     = useState(false);
  const [layout, setLayout]       = useState<LayoutName>('default');

  const activeEl   = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const layoutRef  = useRef<LayoutName>('default');
  const wrapperRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbRef      = useRef<any>(null);
  const pinLock    = usePinLockContext();

  useEffect(() => { setMounted(true); }, []);

  /* ── CSS-Variable für Tastatur-Höhe ── */
  useEffect(() => {
    if (!visible || !wrapperRef.current) return;
    const el = wrapperRef.current;
    const update = () =>
      document.documentElement.style.setProperty('--vk-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  const close = useCallback(() => {
    const el = activeEl.current;
    if (el) {
      /* inputMode wiederherstellen */
      const orig = el.dataset.vkOrigInputMode;
      if (orig !== undefined) {
        el.inputMode = orig;
        delete el.dataset.vkOrigInputMode;
      }
    }
    activeEl.current = null;
    setVisible(false);
    document.body.classList.remove('vk-open');
    document.documentElement.style.removeProperty('--vk-h');
  }, []);

  const openFor = useCallback((el: HTMLInputElement | HTMLTextAreaElement) => {
    /* native OS-Tastatur unterdrücken */
    if (el.dataset.vkOrigInputMode === undefined) {
      el.dataset.vkOrigInputMode = el.inputMode ?? '';
    }
    el.inputMode = 'none';

    activeEl.current = el;

    const l = defaultLayoutFor(el);
    layoutRef.current = l;
    setLayout(l);
    setVisible(true);
    document.body.classList.add('vk-open');

    /* Wert synchronisieren */
    requestAnimationFrame(() => kbRef.current?.setInput(el.value ?? ''));
  }, []);

  /* Fokus auf Text-Input → Tastatur öffnen */
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      if (pinLock.locked || pinLock.screenOff) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (t.disabled) return;
      if (t.readOnly) return;
      if (t.dataset.noKeyboard === 'true') return;
      if (!TEXT_INPUT_TYPES.has(t.type)) return;
      openFor(t);
    };
    document.addEventListener('focusin', handler);
    return () => document.removeEventListener('focusin', handler);
  }, [openFor, pinLock.locked, pinLock.screenOff]);

  /* Pointer außerhalb von Tastatur + Inputs → schließen */
  useEffect(() => {
    if (!visible) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (isInsideKeyboard(t)) return;
      if (t === activeEl.current) return;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      close();
    };
    /* capture: false — wir wollen NACH Radix laufen, nicht davor */
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [visible, close]);

  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) close();
  }, [pinLock.locked, pinLock.screenOff, close]);

  const onKeyPress = useCallback((btn: string) => {
    const el = activeEl.current;

    /* Layout-Umschalter — kein activeEl nötig */
    if (btn === '{shift}') {
      setLayout(prev => {
        const next: LayoutName = prev === 'shift' ? 'default' : 'shift';
        layoutRef.current = next;
        return next;
      });
      return;
    }
    if (btn === '{numbers}') { layoutRef.current = 'numbers'; setLayout('numbers'); return; }
    if (btn === '{default}') { layoutRef.current = 'default'; setLayout('default'); return; }

    if (!el) return;

    if (btn === '{enter}') { close(); return; }

    const cur = el.value ?? '';
    const next =
      btn === '{bksp}' ? cur.slice(0, -1) :
      btn === '{space}' ? cur + ' ' :
      cur + btn;

    setNativeValue(el, next);
    kbRef.current?.setInput(next);

    if (layoutRef.current === 'shift') {
      layoutRef.current = 'default';
      setLayout('default');
    }
  }, [close]);

  const kb = visible && mounted
    ? createPortal(
      <div
        ref={wrapperRef}
        className="vk-root"
        /* preventDefault blockiert native Fokuswechsel beim Tap auf Keys */
        onMouseDown={e => e.preventDefault()}
        onTouchStart={e => e.stopPropagation()}
      >
        <button
          type="button"
          className="virtual-keyboard-close"
          onMouseDown={e => { e.preventDefault(); close(); }}
          aria-label="Tastatur schließen"
        >
          <X size={18} />
        </button>
        <Keyboard
          keyboardRef={(r: unknown) => { kbRef.current = r; }}
          onKeyPress={onKeyPress}
          layoutName={layout}
          layout={LAYOUTS}
          display={DISPLAY}
          theme="hg-theme-default smarthome-kb"
          preventMouseDownDefault
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
