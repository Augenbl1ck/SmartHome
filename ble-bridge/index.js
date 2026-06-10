/**
 * SmartHome BLE Bridge Daemon
 *
 * Laeuft auf dem Raspberry Pi als systemd-Service.
 * Stellt eine interne HTTP-API bereit, die Laravel aufrufen kann.
 *
 * POST /switch
 *   Body: { deviceId: number, bleAddress: string, on: boolean }
 *
 * GET /status
 *   Gibt alle verbundenen Geraete zurueck
 *
 * GET /health
 *   Heartbeat fuer Monitoring
 *
 * Protokoll: Shelly Plug S Gen3 BLE RPC
 *   Service:  5f6d4f53-5f52-5043-5f53-56435f49445f
 *   Data:     5f6d4f53-5f52-5043-5f64-6174615f5f5f  (Read+Write+Notify)
 *   TX CTL:   5f6d4f53-5f52-5043-5f74-785f63746c5f  (Write)
 *   RX CTL:   5f6d4f53-5f52-5043-5f72-785f63746c5f  (Read+Notify)
 */

'use strict';

const express = require('express');
const noble   = require('@stoprocent/noble');

const PORT           = process.env.PORT           || 3001;
const SCAN_TIMEOUT   = parseInt(process.env.SCAN_TIMEOUT  || '15000', 10); // ms
const CMD_TIMEOUT    = parseInt(process.env.CMD_TIMEOUT   || '10000', 10); // ms

// Shelly Gen3 BLE UUIDs (ohne Bindestriche fuer noble)
const SHELLY_SERVICE = '5f6d4f535f52504'  + '35f535643'  + '5f49445f'; // Leerzeichen entfernt
const DATA_CHAR      = '5f6d4f535f525043' + '5f64617461' + '5f5f5f';
const TX_CTL_CHAR    = '5f6d4f535f525043' + '5f74785f63' + '746c5f';

// UUID-Konstanten (original, mit Bindestrichen)
const SVC_UUID  = '5f6d4f53-5f52-5043-5f53-56435f49445f';
const DATA_UUID = '5f6d4f53-5f52-5043-5f64-6174615f5f5f';
const TXCT_UUID = '5f6d4f53-5f52-5043-5f74-785f63746c5f';

// Verbundene Geraete speichern: bleAddress -> { peripheral, characteristic }
const connected = new Map();

// -------------------------------------------------------------------------
// Noble BLE
// -------------------------------------------------------------------------

noble.on('stateChange', (state) => {
  console.log(`[BLE Bridge] Bluetooth Status: ${state}`);
  if (state === 'poweredOn') {
    console.log('[BLE Bridge] Bluetooth bereit.');
  }
});

/**
 * Verbindet mit einem Shelly Gen3 per BLE-Adresse.
 * Gibt die beschreibbare Charakteristik zurueck.
 */
async function connectToDevice(bleAddress) {
  if (connected.has(bleAddress)) {
    const entry = connected.get(bleAddress);
    if (entry.peripheral.state === 'connected') {
      return entry.characteristic;
    }
    connected.delete(bleAddress);
  }

  // Shelly-Geräte: BLE-MAC weicht von der im Namen enthaltenen WiFi-MAC ab.
  // Wir bauen einen "fuzzy" Vergleich: erste 5 Bytes müssen übereinstimmen,
  // letztes Byte darf ±4 abweichen (typisch: WiFi-MAC + 2 = BLE-MAC).
  function macMatches(peripheralAddr, target) {
    const a = peripheralAddr.toLowerCase().replace(/[:-]/g, '');
    const t = target.toLowerCase().replace(/[:-]/g, '');
    if (a === t) return true; // exakter Treffer
    if (a.slice(0, 10) !== t.slice(0, 10)) return false; // erste 5 Bytes müssen gleich sein
    const diff = Math.abs(parseInt(a.slice(10), 16) - parseInt(t.slice(10), 16));
    return diff <= 4;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      noble.stopScanning();
      noble.removeAllListeners('discover');
      reject(new Error(`Timeout: Geraet ${bleAddress} nicht gefunden`));
    }, SCAN_TIMEOUT);

    noble.on('discover', async (peripheral) => {
      if (!macMatches(peripheral.address, bleAddress)) return;

      clearTimeout(timeout);
      noble.stopScanning();
      noble.removeAllListeners('discover');

      // Tatsächliche BLE-Adresse für Cache verwenden
      const actualAddress = peripheral.address.toLowerCase();
      console.log(`[BLE Bridge] Geraet gefunden: ${peripheral.advertisement.localName || bleAddress} (${actualAddress})`);

      try {
        await peripheral.connectAsync();

        const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
          [SVC_UUID.replace(/-/g, '')],
          [DATA_UUID.replace(/-/g, ''), TXCT_UUID.replace(/-/g, '')]
        );

        const writeable = characteristics.find(c =>
          c.properties.includes('write') || c.properties.includes('writeWithoutResponse')
        );

        if (!writeable) {
          reject(new Error('Keine beschreibbare Charakteristik gefunden'));
          return;
        }

        peripheral.on('disconnect', () => {
          console.log(`[BLE Bridge] Geraet ${bleAddress} getrennt`);
          connected.delete(bleAddress);
        });

        connected.set(bleAddress, { peripheral, characteristic: writeable });
        console.log(`[BLE Bridge] Verbunden mit ${bleAddress}`);
        resolve(writeable);
      } catch (err) {
        reject(err);
      }
    });

    noble.startScanning([], false);
  });
}

/**
 * Sendet Switch.Set RPC an Shelly Gen3.
 */
async function switchSet(bleAddress, on) {
  const characteristic = await connectToDevice(bleAddress);

  const cmd = JSON.stringify({
    id:     1,
    src:    'smarthome-ble-bridge',
    method: 'Switch.Set',
    params: { id: 0, on },
  });

  const buffer = Buffer.from(cmd, 'utf8');

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Write Timeout')), CMD_TIMEOUT);

    // Versuche erst writeAsync (mit Antwort), dann writeWithoutResponseAsync
    const useResponse = characteristic.properties.includes('write');

    characteristic.write(buffer, !useResponse, (err) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve();
    });
  });

  console.log(`[BLE Bridge] Switch.Set ${on ? 'ON' : 'OFF'} -> ${bleAddress}`);
}

// -------------------------------------------------------------------------
// Express HTTP Server
// -------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Nur von localhost erreichbar (Laravel auf demselben Pi)
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    bluetooth: noble.state,
    connected: connected.size,
  });
});

// Verbundene Geraete
app.get('/status', (_req, res) => {
  const devices = [];
  for (const [addr, entry] of connected.entries()) {
    devices.push({
      address:   addr,
      state:     entry.peripheral.state,
      name:      entry.peripheral.advertisement?.localName || null,
    });
  }
  res.json({ devices });
});

// Schalter steuern
app.post('/switch', async (req, res) => {
  const { bleAddress, on, deviceId } = req.body;

  if (!bleAddress) {
    return res.status(400).json({ error: 'bleAddress erforderlich' });
  }

  if (typeof on !== 'boolean') {
    return res.status(400).json({ error: 'on (boolean) erforderlich' });
  }

  try {
    await switchSet(bleAddress, on);
    res.json({ success: true, deviceId, bleAddress, on });
  } catch (err) {
    console.error(`[BLE Bridge] Fehler:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Verbindung trennen
app.post('/disconnect', (req, res) => {
  const { bleAddress } = req.body;
  if (connected.has(bleAddress)) {
    const entry = connected.get(bleAddress);
    entry.peripheral.disconnect();
    connected.delete(bleAddress);
  }
  res.json({ success: true });
});

// BLE-Scan: sucht nach Shelly-Geraeten in der Naehe
// GET /scan?timeout=8000&prefix=Shelly
app.get('/scan', (req, res) => {
  if (noble.state !== 'poweredOn') {
    return res.status(503).json({ error: 'Bluetooth nicht bereit: ' + noble.state });
  }

  const timeout = Math.min(parseInt(req.query.timeout || '8000', 10), 30000);
  const prefix  = (req.query.prefix || '').toLowerCase();
  const found   = new Map(); // address -> { address, name, rssi }

  noble.on('discover', (peripheral) => {
    const name = peripheral.advertisement?.localName || '';
    if (prefix && !name.toLowerCase().includes(prefix)) return;
    const addr = peripheral.address;
    if (!found.has(addr)) {
      found.set(addr, { address: addr, name: name || null, rssi: peripheral.rssi });
    }
  });

  noble.startScanning([], true); // duplicates=true fuer RSSI-Updates

  setTimeout(() => {
    noble.stopScanning();
    noble.removeAllListeners('discover'); // Listener bereinigen
    res.json({ devices: [...found.values()] });
  }, timeout);
});

app.listen(PORT, BIND_HOST, () => {
  console.log(`[BLE Bridge] HTTP API laeuft auf ${BIND_HOST}:${PORT}`);
});
