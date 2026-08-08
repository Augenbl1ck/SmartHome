'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { X } from 'lucide-react';
import { usePinLockContext } from '@/components/PinLockProvider';

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'search', 'url', 'tel', 'password', 'number', '']);

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

/** Setzt den Wert eines React-kontrollierten Inputs nativ. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

function isTextInput(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.tagName === 'TEXTAREA') return true;
  return TEXT_INPUT_TYPES.has(el.type);
}

function restoreInput(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el) return;
  if (el.dataset.vkManaged === '1') {
    el.readOnly = false;
    delete el.dataset.vkManaged;
  }
  if (el.dataset.vkInputMode) {
    el.inputMode = el.dataset.vkInputMode as typeof el.inputMode;
    delete el.dataset.vkInputMode;
  } else {
    el.removeAttribute('inputmode');
  }
}

function prepareInput(el: HTMLInputElement | HTMLTextAreaElement) {
  if (!el.readOnly) {
    el.readOnly = true;
    el.dataset.vkManaged = '1';
  }
  if (el.inputMode) {
    el.dataset.vkInputMode = el.inputMode;
  }
  el.inputMode = 'none';
}

function defaultLayoutFor(el: HTMLInputElement | HTMLTextAreaElement): LayoutName {
  if (el.type === 'tel' || el.type === 'number' || el.inputMode === 'numeric') {
    return 'numbers';
  }
  return 'default';
}

function isKeyboardNode(node: Node | null) {
  if (!node || !(node instanceof HTMLElement)) return false;
  return !!node.closest(
    '.virtual-keyboard-container, .simple-keyboard, .hg-button, .hg-row, .hg-rows'
  );
}

function updateKeyboardHeight(el: HTMLElement | null) {
  if (!el) {
    document.body.style.removeProperty('--vk-height');
    return;
  }
  document.body.style.setProperty('--vk-height', `${el.offsetHeight}px`);
}

export default function VirtualKeyboardProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layoutName, setLayoutName] = useState<LayoutName>('default');

  const activeEl = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const layoutRef = useRef<LayoutName>('default');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyboardRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pinLock = usePinLockContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    layoutRef.current = layoutName;
  }, [layoutName]);

  const close = useCallback(() => {
    restoreInput(activeEl.current);
    activeEl.current = null;
    setVisible(false);
    document.body.classList.remove('virtual-keyboard-open');
    document.body.style.removeProperty('--vk-height');
  }, []);

  const openFor = useCallback((el: HTMLInputElement | HTMLTextAreaElement) => {
    if (activeEl.current && activeEl.current !== el) {
      restoreInput(activeEl.current);
    }

    activeEl.current = el;
    prepareInput(el);

    const layout = defaultLayoutFor(el);
    layoutRef.current = layout;
    setLayoutName(layout);
    setVisible(true);
    document.body.classList.add('virtual-keyboard-open');

    requestAnimationFrame(() => {
      keyboardRef.current?.setInput(el.value);
    });
  }, []);

  /* Focus-In: Tastatur öffnen */
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (pinLock.locked || pinLock.screenOff) return;

      const target = e.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (!isTextInput(target)) return;
      if (target.disabled) return;
      if (target.dataset.noKeyboard === 'true') return;
      if (target.readOnly && target.dataset.vkManaged !== '1') return;

      openFor(target);
    }

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [openFor, pinLock.locked, pinLock.screenOff]);

  /* Klick außerhalb → schließen (nicht bei Tastatur-Tasten) */
  useEffect(() => {
    if (!visible) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (isKeyboardNode(target)) return;
      if (target === activeEl.current) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      close();
    }

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [visible, close]);

  /* Tastatur-Höhe messen → Dialog darüber positionieren */
  useEffect(() => {
    if (!visible || !wrapperRef.current) return;

    const el = wrapperRef.current;
    updateKeyboardHeight(el);

    const ro = new ResizeObserver(() => updateKeyboardHeight(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  useEffect(() => {
    if (pinLock.locked || pinLock.screenOff) close();
  }, [pinLock.locked, pinLock.screenOff, close]);

  const applyValue = useCallback((value: string) => {
    const el = activeEl.current;
    if (!el) return;
    setNativeValue(el, value);
    keyboardRef.current?.setInput(value);
  }, []);

  const onKeyPress = useCallback((button: string) => {
    const el = activeEl.current;
    if (!el) return;

    if (button === '{shift}') {
      setLayoutName(l => {
        const next = l === 'shift' ? 'default' : 'shift';
        layoutRef.current = next;
        return next;
      });
      return;
    }
    if (button === '{numbers}') {
      layoutRef.current = 'numbers';
      setLayoutName('numbers');
      return;
    }
    if (button === '{default}') {
      layoutRef.current = 'default';
      setLayoutName('default');
      return;
    }

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

    applyValue(next);

    if (layoutRef.current === 'shift') {
      layoutRef.current = 'default';
      setLayoutName('default');
    }
  }, [applyValue, close]);

  const keyboard = visible && mounted ? createPortal(
    <div
      ref={wrapperRef}
      className="virtual-keyboard-container"
      /* stopPropagation verhindert Dialog-Schließen, KEIN preventDefault → Keys funktionieren */
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        type="button"
        className="virtual-keyboard-close"
        onClick={close}
        aria-label="Tastatur schließen"
      >
        <X size={18} />
      </button>
      <Keyboard
        keyboardRef={(r: unknown) => { keyboardRef.current = r; }}
        onKeyPress={onKeyPress}
        layoutName={layoutName}
        layout={LAYOUTS}
        display={DISPLAY}
        theme="hg-theme-default smarthome-kb"
        useTouchEvents
        preventMouseDownDefault={false}
      />
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {children}
      {keyboard}
    </>
  );
}
