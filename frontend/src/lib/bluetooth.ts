/**
 * Shelly Gen3 BLE RPC Manager
 *
 * Kommuniziert direkt per Web Bluetooth API mit Shelly Gen3 Geräten.
 * Funktioniert nur in Chrome/Edge (kein Firefox).
 * Die Seite muss über localhost oder HTTPS geladen werden.
 *
 * Shelly Gen3 BLE GATT Service UUIDs:
 *   Service:    5f6d4f53-5f52-5043-5f53-56435f49445f
 *   Data-Char:  5f6d4f53-5f52-5043-5f44-41544100ff00
 *
 * Falls der Toggle nicht funktioniert, können die UUIDs hier angepasst werden.
 * Die korrekten UUIDs sind im Shelly Developer Portal dokumentiert:
 *   https://shelly-api-docs.shelly.cloud/gen2/Protocols/BLE/
 *
 * Alternativ können sie mit nRF Connect (Android/iOS App) oder
 * Wireshark/BLE Sniffer aus dem Gerät ausgelesen werden.
 */

// Shelly Gen3 BLE GATT UUIDs (aus Gerät ausgelesen)
export const SHELLY_BLE_SERVICE  = '5f6d4f53-5f52-5043-5f53-56435f49445f';
export const SHELLY_BLE_DATA_OUT = '5f6d4f53-5f52-5043-5f64-6174615f5f5f'; // Read+Write+Notify (Data)
export const SHELLY_BLE_TX_CTL   = '5f6d4f53-5f52-5043-5f74-785f63746c5f'; // Write only (TX control)
export const SHELLY_BLE_RX_CTL   = '5f6d4f53-5f52-5043-5f72-785f63746c5f'; // Read+Notify (RX control)

export type BleState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface BleConnection {
  bleDevice: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  dataOut: BluetoothRemoteGATTCharacteristic;
  onDisconnect?: () => void;
}

class ShelllyBleManager {
  // SmartHome-Gerät-ID → aktive BLE-Verbindung
  private connections = new Map<number, BleConnection>();
  private stateListeners = new Map<number, (s: BleState) => void>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  isConnected(id: number): boolean {
    return !!this.connections.get(id)?.server.connected;
  }

  onStateChange(id: number, cb: (s: BleState) => void) {
    this.stateListeners.set(id, cb);
  }

  offStateChange(id: number) {
    this.stateListeners.delete(id);
  }

  private notify(id: number, state: BleState) {
    this.stateListeners.get(id)?.(state);
  }

  /**
   * Öffnet den Browser-BLE-Scanner.
   * Zeigt alle Geräte in der Nähe an — der Shelly erscheint als
   * "ShellyPlugSG3-XXXXXX" (Groß-/Kleinschreibung je nach Firmware).
   * Falls nur ein bestimmtes Gerät angezeigt werden soll, kann namePrefix
   * gesetzt werden (z.B. 'ShellyPlugSG3-').
   */
  async connect(smarthomeId: number, namePrefix?: string): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('Web Bluetooth wird nicht unterstützt. Bitte Chrome oder Edge verwenden.');
    }

    this.notify(smarthomeId, 'connecting');

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bleDevice: BluetoothDevice = await (navigator as any).bluetooth.requestDevice(
        namePrefix
          ? { filters: [{ namePrefix }], optionalServices: [SHELLY_BLE_SERVICE] }
          : { acceptAllDevices: true, optionalServices: [SHELLY_BLE_SERVICE] }
      );

      bleDevice.addEventListener('gattserverdisconnected', () => {
        this.connections.delete(smarthomeId);
        this.notify(smarthomeId, 'disconnected');
      });

      const server = await bleDevice.gatt!.connect();

      // Alle verfügbaren Services ausgeben (hilft bei falschen UUIDs)
      try {
        const services = await server.getPrimaryServices();
        console.info(
          '[SmartHome BLE] Verfügbare Services auf',
          bleDevice.name,
          ':\n',
          services.map((s) => s.uuid).join('\n'),
        );
      } catch {
        // Nur informativ — ignorieren wenn nicht möglich
      }

      let dataOut: BluetoothRemoteGATTCharacteristic;
      try {
        const service = await server.getPrimaryService(SHELLY_BLE_SERVICE);

        // Alle Characteristics ausgeben um die korrekte UUID zu finden
        try {
          const chars = await service.getCharacteristics();
          console.info(
            '[SmartHome BLE] Characteristics im RPC Service:\n',
            chars.map((c) => `${c.uuid} | props: ${JSON.stringify({
              read: c.properties.read,
              write: c.properties.write,
              writeWithoutResponse: c.properties.writeWithoutResponse,
              notify: c.properties.notify,
            })}`).join('\n'),
          );
          // Erste Characteristic mit Write-Berechtigung automatisch verwenden
          const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
          if (writable) {
            console.info('[SmartHome BLE] Verwende Characteristic:', writable.uuid);
            dataOut = writable;
          } else {
            dataOut = await service.getCharacteristic(SHELLY_BLE_DATA_OUT);
          }
        } catch {
          dataOut = await service.getCharacteristic(SHELLY_BLE_DATA_OUT);
        }
      } catch (charErr) {
        server.disconnect();
        throw new Error(
          `BLE Characteristic nicht gefunden. Schaue in der Browser-Konsole (F12) nach den verfügbaren UUIDs.\n\nFehler: ${charErr instanceof Error ? charErr.message : String(charErr)}`
        );
      }

      this.connections.set(smarthomeId, { bleDevice, server, dataOut });
      this.notify(smarthomeId, 'connected');
    } catch (err) {
      this.notify(smarthomeId, 'error');
      throw err;
    }
  }

  /**
   * Sendet einen Switch.Set RPC-Befehl an das Shelly-Gerät.
   * Dieser Befehl ist identisch mit dem MQTT-Befehl, nur über BLE.
   */
  async switchSet(smarthomeId: number, on: boolean): Promise<void> {
    const conn = this.connections.get(smarthomeId);
    if (!conn || !conn.server.connected) {
      throw new Error('Gerät nicht verbunden');
    }

    const rpc = JSON.stringify({
      id: Date.now(),
      method: 'Switch.Set',
      params: { id: 0, on },
    });

    const encoded = new TextEncoder().encode(rpc);

    // writeValue (mit Response) verwenden — writeWithoutResponse ist false
    await conn.dataOut.writeValue(encoded);
    console.info('[SmartHome BLE] Sent Switch.Set', on ? 'ON' : 'OFF');
  }

  disconnect(smarthomeId: number): void {
    const conn = this.connections.get(smarthomeId);
    if (conn?.server.connected) conn.server.disconnect();
    this.connections.delete(smarthomeId);
    this.notify(smarthomeId, 'disconnected');
  }

  disconnectAll(): void {
    for (const id of this.connections.keys()) this.disconnect(id);
  }
}

// Singleton-Instanz — eine pro Browser-Tab
export const shellyBle = new ShelllyBleManager();
