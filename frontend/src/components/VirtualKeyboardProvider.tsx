'use client';

/*
 * VirtualKeyboardProvider — kein Custom-Keyboard mehr.
 * Stattdessen nutzt die App die native Systemtastatur des Geräts
 * (Pi-Touchscreen, Handy, Tablet) — genau wie jede andere Web-App.
 *
 * Auf dem Raspberry Pi: matchbox-keyboard / onboard / squeekboard oder
 * Chromium mit --enable-virtual-keyboard starten (siehe README).
 */
export default function VirtualKeyboardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
