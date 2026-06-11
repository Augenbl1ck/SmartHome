/**
 * sensor-sim.js — Sensor-Simulations-Script
 *
 * Sendet alle 5 Minuten realistische Temperatur- und Feuchtigkeitswerte
 * an das SmartHome-Backend, damit der Verlaufsgraph sich mit echten Kurven füllt.
 *
 * Starten:   node tools/sensor-sim.js
 * Mit Watch:  node --watch tools/sensor-sim.js
 *
 * Konfiguration: Entweder direkt in diesem Script oder als Umgebungsvariablen
 *   API_URL      = http://localhost:8000/api/v1
 *   INTERVAL_MS  = 300000 (5 Minuten)
 */

'use strict';

const API_URL     = process.env.API_URL     ?? 'http://localhost:8000/api/v1';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS ?? '300000', 10);

// ──────────────────────────────────────────────────────────────────────────────
// Sensoren konfigurieren (ID muss mit der Datenbank übereinstimmen)
// Typ: 'temperature' (°C) oder 'humidity' (%)
// ──────────────────────────────────────────────────────────────────────────────
const SENSORS = [
  { id: 2, name: 'Temp Wohnzimmer',   type: 'temperature', base: 21.5, variance: 2.5 },
  { id: 5, name: 'Temp Schlafzimmer', type: 'temperature', base: 19.0, variance: 2.0 },
  // { id: X, name: 'Luftfeuchte',    type: 'humidity',     base: 55,   variance: 10 },
];

// ──────────────────────────────────────────────────────────────────────────────
// Simulation
// ──────────────────────────────────────────────────────────────────────────────

// Interne Zustände für realistische Drift
const state = Object.fromEntries(
  SENSORS.map(s => [s.id, { value: s.base, trend: 0 }])
);

function nextValue(sensor) {
  const s = state[sensor.id];

  // Leichte Drift (Momentum)
  s.trend += (Math.random() - 0.5) * 0.3;
  s.trend  = Math.max(-0.5, Math.min(0.5, s.trend)); // begrenzen

  s.value += s.trend + (Math.random() - 0.5) * 0.4;

  // Zurück zur Basis driften wenn zu weit weg
  const dist = s.value - sensor.base;
  if (Math.abs(dist) > sensor.variance) {
    s.trend -= dist * 0.1;
  }

  return Math.round(s.value * 10) / 10; // 1 Dezimalstelle
}

async function updateSensor(sensor) {
  const value = nextValue(sensor);
  try {
    const res = await fetch(`${API_URL}/devices/${sensor.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ status: String(value) }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[${sensor.name}] API Fehler ${res.status}: ${text}`);
    } else {
      const unit = sensor.type === 'humidity' ? '%' : '°C';
      console.log(`[${new Date().toLocaleTimeString('de')}] ${sensor.name}: ${value}${unit}`);
    }
  } catch (err) {
    console.error(`[${sensor.name}] Netzwerkfehler: ${err.message}`);
  }
}

async function tick() {
  console.log(`\n── Sensor-Update ${new Date().toLocaleString('de')} ──`);
  await Promise.all(SENSORS.map(updateSensor));
}

// ──────────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────────

console.log(`SmartHome Sensor-Simulation`);
console.log(`API:      ${API_URL}`);
console.log(`Interval: ${INTERVAL_MS / 1000}s`);
console.log(`Sensoren: ${SENSORS.map(s => `${s.name} (ID ${s.id})`).join(', ')}`);
console.log('──────────────────────────────────────');
console.log('Passe die SENSORS-Liste in diesem Script an deine Geräte-IDs an.');
console.log('Sensor-IDs findest du unter: http://localhost:8000/api/v1/devices');
console.log('──────────────────────────────────────\n');

tick(); // sofort einmal senden
setInterval(tick, INTERVAL_MS);
