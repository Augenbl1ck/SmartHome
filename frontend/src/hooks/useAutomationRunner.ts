'use client';

/**
 * Client-seitiger Automation-Runner
 *
 * Läuft im Browser solange die Seite offen ist (Fallback).
 * Primäre Ausführung: Backend AutomationEngine via MQTT + Scheduler.
 *
 * Unterstützte Trigger (Client):
 *   - time / weekday_time
 *   - device_status (Zustand, ohne Edge-Detection)
 *   - temperature_above/below, humidity_above/below
 *   - battery_low, power_above
 *
 * Geräte-Edge-Trigger (motion, door, flood, smoke) feuert zuverlässig nur im Backend.
 */

import { useEffect, useRef } from 'react';
import { api, Device } from '@/lib/api';
import { shellyBle } from '@/lib/bluetooth';

// Verhindert dass dieselbe Automation mehrmals pro Minute feuert
const fired = new Map<number, string>(); // automationId → 'YYYY-MM-DDTHH:MM'

function nowKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function checkTimeTrigger(trigger: Record<string, unknown>): boolean {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const currentDay = now.getDay(); // 0=So, 1=Mo, ...

  if (trigger.type === 'time') {
    return trigger.time === currentTime;
  }

  if (trigger.type === 'weekday_time') {
    const weekdays = (trigger.weekdays as number[]) ?? [];
    return trigger.time === currentTime && weekdays.includes(currentDay);
  }

  return false;
}

function checkDeviceStatusTrigger(trigger: Record<string, unknown>, devices: Device[]): boolean {
  if (trigger.type === 'device_status') {
    const device = devices.find((d) => d.id === Number(trigger.device_id));
    return device?.status === trigger.status;
  }
  return false;
}

/** Temperatur analog zur Backend-Engine: local_temperature → temperature → numeric status */
function resolveTemperature(device: Device): number | null {
  const attrs = device.attributes ?? {};
  const local = attrs.local_temperature;
  if (typeof local === 'number' || (typeof local === 'string' && local !== '' && !isNaN(Number(local)))) {
    return Number(local);
  }
  const temp = attrs.temperature;
  if (typeof temp === 'number' || (typeof temp === 'string' && temp !== '' && !isNaN(Number(temp)))) {
    return Number(temp);
  }
  const fromStatus = parseFloat(device.status);
  return isNaN(fromStatus) ? null : fromStatus;
}

function resolveHumidity(device: Device): number | null {
  const hum = device.attributes?.humidity;
  if (typeof hum === 'number' || (typeof hum === 'string' && hum !== '' && !isNaN(Number(hum)))) {
    return Number(hum);
  }
  const fromStatus = parseFloat(device.status);
  return isNaN(fromStatus) ? null : fromStatus;
}

/**
 * sensor_threshold + temperature/humidity/battery/power thresholds
 */
function checkSensorThresholdTrigger(trigger: Record<string, unknown>, devices: Device[]): boolean {
  const type = trigger.type as string;
  const isSensorThreshold = type === 'sensor_threshold'
    || type === 'temperature_above' || type === 'temperature_below'
    || type === 'humidity_above'    || type === 'humidity_below'
    || type === 'battery_low'       || type === 'power_above';

  if (!isSensorThreshold) return false;

  const device = devices.find((d) => d.id === Number(trigger.device_id));
  if (!device) return false;

  const threshold = Number(trigger.threshold);

  if (type === 'temperature_above' || type === 'temperature_below') {
    const value = resolveTemperature(device);
    if (value === null) return false;
    return type === 'temperature_above' ? value > threshold : value < threshold;
  }

  if (type === 'humidity_above' || type === 'humidity_below') {
    const value = resolveHumidity(device);
    if (value === null) return false;
    return type === 'humidity_above' ? value > threshold : value < threshold;
  }

  if (type === 'battery_low') {
    const battery = device.attributes?.battery;
    if (battery === undefined || battery === null || isNaN(Number(battery))) return false;
    return Number(battery) < (Number.isNaN(threshold) ? 20 : threshold);
  }

  if (type === 'power_above') {
    const power = device.attributes?.power_w;
    if (power === undefined || power === null || isNaN(Number(power))) return false;
    return Number(power) > threshold;
  }

  // Legacy sensor_threshold
  const value = parseFloat(device.status);
  if (isNaN(value)) return false;
  const op = trigger.operator as string | undefined;
  if (op === 'lt')  return value <  threshold;
  if (op === 'gt')  return value >  threshold;
  if (op === 'lte') return value <= threshold;
  if (op === 'gte') return value >= threshold;

  return false;
}

async function executeAction(action: Record<string, unknown>, devices: Device[]): Promise<void> {
  const t = action.type as string;

  const executeToggle = async (deviceId: number, targetStatus: 'on' | 'off' | 'toggle') => {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return;

    const isBle = device.attributes?.protocol === 'bluetooth_shelly_gen3';
    const newStatus: 'on' | 'off' =
      targetStatus === 'toggle'
        ? device.status === 'on' ? 'off' : 'on'
        : targetStatus;

    if (isBle) {
      if (!shellyBle.isConnected(deviceId)) {
        console.warn(`[AutomationRunner] BLE-Gerät ${device.name} nicht verbunden — Automation übersprungen`);
        return;
      }
      await shellyBle.switchSet(deviceId, newStatus === 'on');
      await api.toggleDevice(deviceId);
      console.info(`[AutomationRunner] BLE ${device.name} → ${newStatus}`);
    } else {
      await api.setDeviceStatus(deviceId, newStatus);
      console.info(`[AutomationRunner] API ${device.name} → ${newStatus}`);
    }
  };

  if (t === 'set_device_status') {
    const status = String(action.status ?? 'off');
    if (status === 'on' || status === 'off') {
      await executeToggle(Number(action.device_id), status);
    } else {
      // Cover open/close/stop oder andere Status-Strings
      await api.setDeviceStatus(Number(action.device_id), status);
      console.info(`[AutomationRunner] set-status ${action.device_id} → ${status}`);
    }
  } else if (t === 'toggle_device') {
    await executeToggle(Number(action.device_id), 'toggle');
  } else if (t === 'delayed_off') {
    const minutes = Number(action.minutes ?? 10);
    setTimeout(() => executeToggle(Number(action.device_id), 'off'), minutes * 60 * 1000);
    console.info(`[AutomationRunner] Verzögertes AUS in ${minutes} Min.`);
  } else if (t === 'delayed_on') {
    const minutes = Number(action.minutes ?? 10);
    setTimeout(() => executeToggle(Number(action.device_id), 'on'), minutes * 60 * 1000);
    console.info(`[AutomationRunner] Verzögertes EIN in ${minutes} Min.`);
  } else if (t === 'set_room_devices') {
    const roomDevices = devices.filter(
      (d) => d.room_id === Number(action.room_id) && d.type !== 'thermostat',
    );
    for (const d of roomDevices) {
      await executeToggle(d.id, action.status as 'on' | 'off');
    }
  } else if (t === 'set_thermostat_setpoint') {
    const setpoint = Math.max(4, Math.min(35, Number(action.setpoint ?? 21)));
    await api.setDeviceStatus(Number(action.device_id), String(setpoint));
    console.info(`[AutomationRunner] Thermostat ${action.device_id} Sollwert → ${setpoint}°C`);
  } else if (t === 'set_thermostat_mode') {
    const mode = String(action.mode ?? 'heat');
    if (['off', 'auto', 'heat'].includes(mode)) {
      await api.setDeviceStatus(Number(action.device_id), mode);
      console.info(`[AutomationRunner] Thermostat ${action.device_id} Modus → ${mode}`);
    }
  } else if (t === 'notify') {
    console.info(`[AutomationRunner] Benachrichtigung: ${action.message}`);
  }
}

async function runAutomations() {
  try {
    const [automations, devices] = await Promise.all([
      api.getAutomations(),
      api.getDevices(),
    ]);

    const key = nowKey();

    for (const automation of automations) {
      if (!automation.enabled) continue;

      const trigger = automation.trigger as Record<string, unknown>;
      const action = automation.action as Record<string, unknown>;

      // Schon in dieser Minute gefeuert? Überspringen
      if (fired.get(automation.id) === key) continue;

      let shouldFire = false;

      if (trigger.type === 'time' || trigger.type === 'weekday_time') {
        shouldFire = checkTimeTrigger(trigger);
      } else if (trigger.type === 'device_status') {
        shouldFire = checkDeviceStatusTrigger(trigger, devices);
      } else {
        // temperature/humidity/battery/power (+ legacy sensor_threshold)
        shouldFire = checkSensorThresholdTrigger(trigger, devices);
      }

      if (shouldFire) {
        fired.set(automation.id, key);
        console.info(`[AutomationRunner] Automation "${automation.name}" wird ausgeführt`);
        try {
          await executeAction(action, devices);
        } catch (err) {
          console.warn(`[AutomationRunner] Fehler bei "${automation.name}":`, err);
        }
      }
    }
  } catch (err) {
    // Kein Internet / Backend offline → still fail
    console.warn('[AutomationRunner] Fehler beim Laden:', err);
  }
}

export function useAutomationRunner() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sofort einmal prüfen
    runAutomations();

    // Danach jede Minute
    intervalRef.current = setInterval(runAutomations, 60 * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
