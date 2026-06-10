/**
 * Shelly Gen3 BLE Manager
 *
 * Verbindungsstrategie:
 *   1. Automatisch: navigator.bluetooth.getDevices() — verbindet bereits
 *      gekoppelte Geräte ohne Picker-Dialog (Chrome/Chromium 85+).
 *   2. Manuell: requestDevice() — zeigt Picker nur beim ersten Mal.
 *
 * Shelly Gen3 GATT-UUIDs:
 *   Service:   5f6d4f53-5f52-5043-5f53-56435f49445f
 *   Data-Char: 5f6d4f53-5f52-5043-5f64-6174615f5f5f
 */

export const SHELLY_BLE_SERVICE  = '5f6d4f53-5f52-5043-5f53-56435f49445f';
export const SHELLY_BLE_DATA_OUT = '5f6d4f53-5f52-5043-5f64-6174615f5f5f';

export type BleState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface BleConn {
  bleDevice: BluetoothDevice;
  server:    BluetoothRemoteGATTServer;
  dataOut:   BluetoothRemoteGATTCharacteristic;
}

// localStorage: smarthomeId → previously paired BLE device name
const PAIRED_KEY = 'smarthome_ble_paired';
function loadPaired(): Record<number, string> {
  try { return JSON.parse(localStorage.getItem(PAIRED_KEY) ?? '{}'); } catch { return {}; }
}
function savePaired(id: number, name: string) {
  const p = loadPaired(); p[id] = name;
  localStorage.setItem(PAIRED_KEY, JSON.stringify(p));
}
function forgetPaired(id: number) {
  const p = loadPaired(); delete p[id];
  localStorage.setItem(PAIRED_KEY, JSON.stringify(p));
}

class ShellyBleManager {
  private connections  = new Map<number, BleConn>();
  private stateListeners = new Map<number, (s: BleState) => void>();
  private reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();

  isSupported() { return typeof navigator !== 'undefined' && 'bluetooth' in navigator; }
  isConnected(id: number) { return !!this.connections.get(id)?.server.connected; }

  onStateChange(id: number, cb: (s: BleState) => void)  { this.stateListeners.set(id, cb); }
  offStateChange(id: number)                             { this.stateListeners.delete(id); }
  private notify(id: number, s: BleState)                { this.stateListeners.get(id)?.(s); }

  // ── Kernlogik: BleDevice → verbundene GATT-Verbindung ────────────
  private async connectDevice(smarthomeId: number, bleDevice: BluetoothDevice): Promise<void> {
    const server = await bleDevice.gatt!.connect();

    // Writable Characteristic finden
    let dataOut: BluetoothRemoteGATTCharacteristic;
    try {
      const service = await server.getPrimaryService(SHELLY_BLE_SERVICE);
      const chars   = await service.getCharacteristics();
      const writable = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      dataOut = writable ?? await service.getCharacteristic(SHELLY_BLE_DATA_OUT);
      console.info('[BLE] Verbunden mit', bleDevice.name, '— Char:', dataOut.uuid);
    } catch (err) {
      server.disconnect();
      throw new Error(`BLE Characteristic nicht gefunden: ${err instanceof Error ? err.message : err}`);
    }

    this.connections.set(smarthomeId, { bleDevice, server, dataOut });

    // Automatisch wieder verbinden bei unerwartetem Trennen
    bleDevice.addEventListener('gattserverdisconnected', () => {
      this.connections.delete(smarthomeId);
      this.notify(smarthomeId, 'disconnected');
      console.info('[BLE] Getrennt von', bleDevice.name, '— versuche Auto-Reconnect…');
      this.scheduleAutoReconnect(smarthomeId);
    });

    this.notify(smarthomeId, 'connected');
  }

  // ── Automatische Wiederverbindung (ohne Picker) ───────────────────
  async tryAutoConnect(smarthomeId: number): Promise<boolean> {
    if (!this.isSupported() || this.isConnected(smarthomeId)) return this.isConnected(smarthomeId);

    const paired = loadPaired();
    const pairedName = paired[smarthomeId];

    try {
      // getDevices() gibt alle bisher genehmigten BLE-Geräte zurück — kein Picker nötig
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getDevices = (navigator as any).bluetooth?.getDevices;
      if (!getDevices) return false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allDevices: BluetoothDevice[] = await (navigator as any).bluetooth.getDevices();
      if (allDevices.length === 0) return false;

      // Passendes Gerät finden: zuerst nach gespeichertem Namen, sonst erstes Gerät
      const target = pairedName
        ? allDevices.find(d => d.name === pairedName) ?? allDevices[0]
        : allDevices[0];

      this.notify(smarthomeId, 'connecting');
      await this.connectDevice(smarthomeId, target);
      return true;
    } catch (err) {
      console.warn('[BLE] Auto-Connect fehlgeschlagen:', err);
      this.notify(smarthomeId, 'disconnected');
      return false;
    }
  }

  private scheduleAutoReconnect(smarthomeId: number, delayMs = 3000) {
    clearTimeout(this.reconnectTimers.get(smarthomeId));
    const t = setTimeout(async () => {
      this.reconnectTimers.delete(smarthomeId);
      if (!this.isConnected(smarthomeId)) {
        await this.tryAutoConnect(smarthomeId);
      }
    }, delayMs);
    this.reconnectTimers.set(smarthomeId, t);
  }

  // ── Manueller Connect (zeigt Picker — nur beim ersten Mal nötig) ──
  async connect(smarthomeId: number, namePrefix?: string): Promise<void> {
    if (!this.isSupported()) throw new Error('Web Bluetooth wird nicht unterstützt (Chrome/Edge/Chromium).');
    this.notify(smarthomeId, 'connecting');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bleDevice: BluetoothDevice = await (navigator as any).bluetooth.requestDevice(
        namePrefix
          ? { filters: [{ namePrefix }], optionalServices: [SHELLY_BLE_SERVICE] }
          : { acceptAllDevices: true, optionalServices: [SHELLY_BLE_SERVICE] }
      );
      await this.connectDevice(smarthomeId, bleDevice);
      // Gerätename merken → nächstes Mal ohne Picker verbinden
      if (bleDevice.name) savePaired(smarthomeId, bleDevice.name);
    } catch (err) {
      this.notify(smarthomeId, 'error');
      throw err;
    }
  }

  // ── Switch.Set RPC ────────────────────────────────────────────────
  async switchSet(smarthomeId: number, on: boolean): Promise<void> {
    // Wenn nicht verbunden: Auto-Reconnect versuchen bevor Fehler
    if (!this.isConnected(smarthomeId)) {
      const ok = await this.tryAutoConnect(smarthomeId);
      if (!ok) throw new Error('BLE nicht verbunden — bitte einmal manuell koppeln.');
    }

    const conn = this.connections.get(smarthomeId)!;
    const rpc  = JSON.stringify({ id: Date.now(), method: 'Switch.Set', params: { id: 0, on } });
    await conn.dataOut.writeValue(new TextEncoder().encode(rpc));
    console.info('[BLE] Switch.Set', on ? 'ON' : 'OFF', '→', conn.bleDevice.name);
  }

  // ── Kopplung aufheben ─────────────────────────────────────────────
  disconnect(smarthomeId: number): void {
    clearTimeout(this.reconnectTimers.get(smarthomeId));
    this.reconnectTimers.delete(smarthomeId);
    const conn = this.connections.get(smarthomeId);
    if (conn?.server.connected) conn.server.disconnect();
    this.connections.delete(smarthomeId);
    this.notify(smarthomeId, 'disconnected');
  }

  forget(smarthomeId: number): void {
    this.disconnect(smarthomeId);
    forgetPaired(smarthomeId);
  }

  disconnectAll(): void {
    for (const id of [...this.connections.keys()]) this.disconnect(id);
  }

  // Gibt gespeicherten Gerätenamen zurück (für UI-Anzeige)
  getPairedName(smarthomeId: number): string | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    return loadPaired()[smarthomeId];
  }

  /**
   * Öffnet den Chrome BLE Picker, liest die MAC aus dem Gerätenamen
   * (ShellyPlugSG3-AABBCCDDEEFF → AA:BB:CC:DD:EE:FF) und gibt sie zurück.
   * Braucht keine GATT-Verbindung und funktioniert auch auf Windows.
   */
  async getDeviceMacViaPicker(): Promise<{ mac: string; bleName: string }> {
    if (!this.isSupported()) {
      throw new Error('Web Bluetooth wird nicht unterstützt — nutze Chrome oder Chromium.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bleDevice: BluetoothDevice = await (navigator as any).bluetooth.requestDevice({
      filters: [{ namePrefix: 'Shelly' }],
      optionalServices: [SHELLY_BLE_SERVICE],
    });

    if (!bleDevice.name) {
      throw new Error('Gerät hat keinen Namen. Bitte MAC-Adresse manuell eingeben.');
    }

    const mac = extractMacFromShellyName(bleDevice.name);
    if (!mac) {
      throw new Error(
        `Kein 12-stelliger MAC im Namen "${bleDevice.name}" gefunden. Bitte MAC manuell eingeben.`
      );
    }

    return { mac, bleName: bleDevice.name };
  }
}

/** Extrahiert AA:BB:CC:DD:EE:FF aus "ShellyPlugSG3-AABBCCDDEEFF" */
function extractMacFromShellyName(name: string): string | null {
  const last = name.split('-').pop() ?? '';
  if (/^[0-9A-Fa-f]{12}$/.test(last)) {
    return (last.match(/.{2}/g) as string[]).join(':').toUpperCase();
  }
  return null;
}

// Singleton — eine Instanz pro Browser-Tab
export const shellyBle = new ShellyBleManager();
