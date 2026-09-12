/**
 * Nach einem Schaltbefehl kommt oft noch der alte MQTT-/WebSocket-Status
 * (Echo / in-flight Telemetrie). Den ignorieren wir kurz, sonst springt
 * die UI nach „aus“ wieder auf „an“.
 */

const HOLD_MS = 10_000;

const holds = new Map<number, { status: string; until: number }>();

export function holdDeviceStatus(id: number, status: string, ms = HOLD_MS): void {
  holds.set(id, { status, until: Date.now() + ms });
}

export function clearDeviceStatusHold(id: number): void {
  holds.delete(id);
}

export function reconcileRemoteStatus(
  id: number,
  incoming: string | undefined,
  current: string,
): string {
  if (incoming === undefined) return current;
  const hold = holds.get(id);
  if (!hold) return incoming;
  if (Date.now() > hold.until) {
    holds.delete(id);
    return incoming;
  }
  if (incoming !== hold.status) return current;
  return incoming;
}

export function reconcileRemoteDevice<T extends { id: number; status: string }>(
  current: T,
  incoming: Partial<T> & { id?: number },
): T {
  const merged = { ...current, ...incoming };
  merged.status = reconcileRemoteStatus(
    current.id,
    incoming.status ?? current.status,
    current.status,
  );
  return merged;
}
