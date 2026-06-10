/**
 * Einfaches Browser-Event-System für Gerätezustand-Synchronisation.
 * Wenn ein Gerät in einer Komponente umgeschaltet wird, werden alle anderen
 * Komponenten auf derselben Seite automatisch aktualisiert.
 */

export const DEVICE_UPDATE_EVENT = 'smarthome:device-update';

export function emitDeviceUpdate(id: number, status: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DEVICE_UPDATE_EVENT, { detail: { id, status } })
  );
}
