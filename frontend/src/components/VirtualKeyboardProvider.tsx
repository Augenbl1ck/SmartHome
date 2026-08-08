'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { X } from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'search', 'url', 'tel', 'password', '']);

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
    '. , : ; ! ? \' " {bksp}',
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

/** Setzt den Wert eines React-kontrollierten Inputs nativ,
 *  sodass React den onChange-Handler auslöst. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function VirtualKeyboardProvider({ children }: { children: React.ReactNode }) {
  const [visible,    setVisible]    = useState(false);
  const [layoutName, setLayoutName] = useState<LayoutName>('default');
  const activeEl    = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const pointerInside = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyboardRef = useRef<any>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const pinLock = usePinLockContext();

  const openFor = useCallback((el: HTMLInputElement | HTMLTextAreaElement) => {
    activeEl.current = el;
    keyboardRef.current?.setInput(el.value);
    setLayoutName('default');
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    activeEl.current = null;
  }, []);

  /* Globaler focusin-Listener */
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (pinLock.locked || pinLock.screenOff) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;
      const input = target as HTMLInputElement;
      if (!TEXT_INPUT_TYPES.has(input.type)) return;
      if (input.readOnly || input.disabled) return;
      if ((input as HTMLElement).dataset.noKeyboard === 'true') return;
      openFor(input as HTMLInputElement | HTMLTextAreaElement);
    }

    function onFocusOut(e: FocusEvent) {
      const related = e.relatedTarget as HTMLElement | null;
      if (related && wrapperRef.current?.contains(related)) return;
      if (pointerInside.current) return;
      setTimeout(() => {
        const active = document.activeElement;
        if (!active) { close(); return; }
        if (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') {
          close();
        }
      }, 80);
    }

    document.addEventListener('focusin',  onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin',  onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [openFor, close, pinLock.locked, pinLock.screenOff]);

  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) {
      close();
    }
  }, [pinLock.locked, pinLock.screenOff, close]);

  function onKeyPress(button: string) {
    const el = activeEl.current;

    /* Layout-Umschalter */
    if (button === '{shift}') {
      setLayoutName(l => l === 'shift' ? 'default' : 'shift');
      return;
    }
    if (button === '{numbers}') { setLayoutName('numbers'); return; }
    if (button === '{default}') { setLayoutName('default'); return; }

    if (!el) return;

    let next: string;
    if (button === '{bksp}') {
      next = el.value.slice(0, -1);
    } else if (button === '{enter}') {
      close();
      el.blur();
      return;
    } else if (button === '{space}') {
      next = el.value + ' ';
    } else {
      next = el.value + button;
    }

    setNativeValue(el, next);
    keyboardRef.current?.setInput(next);

    // Shift nach Buchstabe zurücksetzen
    if (layoutName === 'shift') setLayoutName('default');
  }

  return (
    <>
      {children}
      {visible && (
        <div
          ref={wrapperRef}
          className="virtual-keyboard-container"
          /* Verhindert, dass Klick auf Tastatur das Input-Blur auslöst */
          onMouseDown={e => e.preventDefault()}
          onPointerDown={e => e.preventDefault()}
          onPointerEnter={() => { pointerInside.current = true; }}
          onPointerLeave={() => { pointerInside.current = false; }}
        >
          <button
            className="virtual-keyboard-close"
            onPointerDown={e => { e.preventDefault(); close(); }}
            aria-label="Tastatur schließen"
          >
            <X size={18} />
          </button>
          <Keyboard
            keyboardRef={(r: any) => { keyboardRef.current = r; }}
            onKeyPress={onKeyPress}
            layoutName={layoutName}
            layout={LAYOUTS}
            display={DISPLAY}
            theme="hg-theme-default smarthome-kb"
          />
        </div>
      )}
    </>
  );
}
