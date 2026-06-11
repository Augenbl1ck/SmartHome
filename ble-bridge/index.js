/**
 * SmartHome BLE Bridge Daemon
 */

'use strict';

const express = require('express');
const noble   = require('@stoprocent/noble');

const PORT           = process.env.PORT           || 3001;
const SCAN_TIMEOUT   = parseInt(process.env.SCAN_TIMEOUT  || '15000', 10);
const CMD_TIMEOUT    = parseInt(process.env.CMD_TIMEOUT   || '10000', 10);

const SVC_UUID  = '5f6d4f53-5f52-5043-5f53-56435f49445f';
const DATA_UUID = '5f6d4f53-5f52-5043-5f64-6174615f5f5f';
const TXCT_UUID = '5f6d4f53-5f52-5043-5f74-785f63746c5f';
const DATA_CHAR = '5f6d4f535f5250435f646174615f5f5f';

const connected = new Map();

noble.on('stateChange', (state) => {
  console.log('[BLE Bridge] Bluetooth Status: ' + state);
  if (state === 'poweredOn') console.log('[BLE Bridge] Bluetooth bereit.');
});

function macMatches(peripheralAddr, target) {
  const a = peripheralAddr.toLowerCase().replace(/[:-]/g, '');
  const t = target.toLowerCase().replace(/[:-]/g, '');
  if (a === t) return true;
  if (a.slice(0, 10) !== t.slice(0, 10)) return false;
  const diff = Math.abs(parseInt(a.slice(10), 16) - parseInt(t.slice(10), 16));
  return diff <= 4;
}

async function connectToDevice(bleAddress) {
  if (connected.has(bleAddress)) {
    const entry = connected.get(bleAddress);
    if (entry.peripheral.state === 'connected') return entry;
    connected.delete(bleAddress);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      noble.stopScanning();
      noble.removeAllListeners('discover');
      reject(new Error('Timeout: Geraet ' + bleAddress + ' nicht gefunden'));
    }, SCAN_TIMEOUT);

    noble.on('discover', async (peripheral) => {
      if (!macMatches(peripheral.address, bleAddress)) return;
      clearTimeout(timeout);
      noble.stopScanning();
      noble.removeAllListeners('discover');
      const actualAddress = peripheral.address.toLowerCase();
      console.log('[BLE Bridge] Geraet gefunden: ' + (peripheral.advertisement.localName || bleAddress) + ' (' + actualAddress + ')');
      try {
        await peripheral.connectAsync();
        const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
          [SVC_UUID.replace(/-/g, '')],
          [DATA_UUID.replace(/-/g, ''), TXCT_UUID.replace(/-/g, '')]
        );
        let dataChar = characteristics.find(c => c.uuid === DATA_CHAR);
        if (!dataChar) {
          dataChar = characteristics.find(c =>
            c.properties.includes('write') || c.properties.includes('writeWithoutResponse')
          );
        }
        if (!dataChar) { reject(new Error('Keine beschreibbare Charakteristik gefunden')); return; }
        try {
          await new Promise((res, rej) => dataChar.subscribe(err => err ? rej(err) : res()));
          console.log('[BLE Bridge] Notifications aktiviert fuer ' + bleAddress);
        } catch (subErr) {
          console.warn('[BLE Bridge] Subscribe fehlgeschlagen: ' + subErr.message);
        }
        peripheral.on('disconnect', () => {
          console.log('[BLE Bridge] Geraet ' + bleAddress + ' getrennt');
          connected.delete(bleAddress);
        });
        const entry = { peripheral, dataChar };
        connected.set(bleAddress, entry);
        console.log('[BLE Bridge] Verbunden mit ' + bleAddress);
        resolve(entry);
      } catch (err) { reject(err); }
    });
    noble.startScanning([], false);
  });
}

async function switchSet(bleAddress, on) {
  const entry = await connectToDevice(bleAddress);
  const cmd = JSON.stringify({ id: 1, src: 'smarthome-ble-bridge', method: 'Switch.Set', params: { id: 0, on } });
  const buffer = Buffer.from(cmd, 'utf8');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Write Timeout')), CMD_TIMEOUT);
    const useResponse = entry.dataChar.properties.includes('write');
    entry.dataChar.write(buffer, !useResponse, (err) => {
      clearTimeout(timeout);
      if (err) reject(err); else resolve();
    });
  });
  console.log('[BLE Bridge] Switch.Set ' + (on ? 'ON' : 'OFF') + ' -> ' + bleAddress);
}

async function rpcCall(bleAddress, method, params) {
  const entry = await connectToDevice(bleAddress);
  const { dataChar } = entry;
  return new Promise((resolve, reject) => {
    const id = (Date.now() % 65535) + 1;
    const cmd = JSON.stringify({ id, src: 'smarthome-bridge', method, params: params || {} });
    let buffer = '';
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      dataChar.removeListener('data', onData);
      reject(new Error('RPC-Timeout fuer ' + method));
    }, CMD_TIMEOUT);
    const onData = (chunk) => {
      if (finished) return;
      buffer += chunk.toString('utf8');
      try {
        const parsed = JSON.parse(buffer);
        clearTimeout(timeout);
        finished = true;
        dataChar.removeListener('data', onData);
        if (parsed.error) reject(new Error('Shelly-Fehler (' + parsed.error.code + '): ' + parsed.error.message));
        else resolve(parsed.result !== undefined ? parsed.result : parsed);
      } catch { /* unvollstaendig, weiter akkumulieren */ }
    };
    dataChar.on('data', onData);
    dataChar.write(Buffer.from(cmd, 'utf8'), false, (err) => {
      if (err && !finished) {
        clearTimeout(timeout);
        finished = true;
        dataChar.removeListener('data', onData);
        reject(err);
      }
    });
  });
}

const app = express();
app.use(express.json());
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', bluetooth: noble.state, connected: connected.size });
});

app.get('/status', (_req, res) => {
  const devices = [];
  for (const [addr, entry] of connected.entries()) {
    devices.push({ address: addr, state: entry.peripheral.state, name: entry.peripheral.advertisement && entry.peripheral.advertisement.localName || null });
  }
  res.json({ devices });
});

app.post('/switch', async (req, res) => {
  const { bleAddress, on, deviceId } = req.body;
  if (!bleAddress) return res.status(400).json({ error: 'bleAddress erforderlich' });
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'on (boolean) erforderlich' });
  try {
    await switchSet(bleAddress, on);
    res.json({ success: true, deviceId, bleAddress, on });
  } catch (err) {
    console.error('[BLE Bridge] Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/rpc', async (req, res) => {
  const { bleAddress, method, params } = req.body;
  if (!bleAddress || !method) return res.status(400).json({ error: 'bleAddress und method erforderlich' });
  const BLOCKED = ['Shelly.Update', 'Shelly.FactoryReset', 'Shelly.Reboot'];
  if (BLOCKED.includes(method)) return res.status(403).json({ error: 'Methode ' + method + ' nicht erlaubt' });
  try {
    const result = await rpcCall(bleAddress, method, params || {});
    res.json({ result });
  } catch (err) {
    console.error('[BLE Bridge] RPC-Fehler (' + method + '):', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/disconnect', (req, res) => {
  const { bleAddress } = req.body;
  if (connected.has(bleAddress)) {
    const entry = connected.get(bleAddress);
    entry.peripheral.disconnect();
    connected.delete(bleAddress);
  }
  res.json({ success: true });
});

app.get('/scan', (req, res) => {
  if (noble.state !== 'poweredOn') {
    return res.status(503).json({ error: 'Bluetooth nicht bereit: ' + noble.state });
  }
  const timeout = Math.min(parseInt(req.query.timeout || '8000', 10), 30000);
  const prefix  = (req.query.prefix || '').toLowerCase();
  const found   = new Map();
  noble.on('discover', (peripheral) => {
    const name = peripheral.advertisement && peripheral.advertisement.localName || '';
    if (prefix && !name.toLowerCase().includes(prefix)) return;
    const addr = peripheral.address;
    if (!found.has(addr)) found.set(addr, { address: addr, name: name || null, rssi: peripheral.rssi });
  });
  noble.startScanning([], true);
  setTimeout(() => {
    noble.stopScanning();
    noble.removeAllListeners('discover');
    res.json({ devices: [...found.values()] });
  }, timeout);
});

app.listen(PORT, BIND_HOST, () => {
  console.log('[BLE Bridge] HTTP API laeuft auf ' + BIND_HOST + ':' + PORT);
});