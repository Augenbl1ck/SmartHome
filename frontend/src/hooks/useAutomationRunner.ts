'use client';

/**
 * Client-seitiger Automation-Runner (Fallback).
 * Primär: Backend AutomationEngine.
 *
 * Conditions-only (trigger.type === 'conditions'): Rising Edge + Minuten-Poll.
 * Legacy-Trigger: time / weekday_time / device_status / Sensor-Thresholds.
 */

import { useEffect, useRef } from 'react';
import { api, Automation, Device } from '@/lib/api';
import { shellyBle } from '@/lib/bluetooth';
import { encodeCapStatus } from '@/lib/thermostat-capabilities';

const fired = new Map<number, string>();
const conditionsMet = new Map<number, boolean>();

function nowKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

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

function evaluateCondition(condition: Record<string, unknown>, devices: Device[]): boolean {
  const type = condition.type as string;
  const device = devices.find((d) => d.id === Number(condition.device_id));

  switch (type) {
    case 'device_status':
      return !!device && device.status === condition.status;
    case 'temperature_above':
    case 'temperature_below': {
      if (!device) return false;
      const value = resolveTemperature(device);
      if (value === null) return false;
      const threshold = Number(condition.threshold);
      return type === 'temperature_above' ? value > threshold : value < threshold;
    }
    case 'humidity_above':
    case 'humidity_below': {
      if (!device) return false;
      const value = resolveHumidity(device);
      if (value === null) return false;
      const threshold = Number(condition.threshold);
      return type === 'humidity_above' ? value > threshold : value < threshold;
    }
    case 'door_open':
      return !!device && device.status === 'open';
    case 'door_closed':
      return !!device && device.status === 'closed';
    case 'motion':
      return !!device && device.status === 'on';
    case 'time_between': {
      const from = String(condition.from ?? '');
      const to = String(condition.to ?? '');
      if (!from || !to) return false;
      const fromDate = String(condition.from_date ?? '');
      const toDate = String(condition.to_date ?? '');
      if (fromDate && toDate) {
        const start = new Date(`${fromDate}T${from}:00`);
        const end = new Date(`${toDate}T${to}:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        const now = new Date();
        return now >= start && now <= end;
      }
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (from > to) return current >= from || current <= to;
      return current >= from && current <= to;
    }
    case 'time_at': {
      const time = String(condition.time ?? '');
      if (!time) return false;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(now.getHours())}:${pad(now.getMinutes())}` === time;
    }
    case 'sunrise':
    case 'sunset': {
      // Backend AutomationEngine is primary; client fallback uses last weather fetch if available.
      const sun = (globalThis as { __smarthomeSun?: { sunrise?: string | null; sunset?: string | null } }).__smarthomeSun;
      const iso = type === 'sunset' ? sun?.sunset : sun?.sunrise;
      if (!iso) return false;
      const offset = Math.max(-120, Math.min(120, Number(condition.offset_minutes ?? 0) || 0));
      const target = new Date(iso);
      if (Number.isNaN(target.getTime())) return false;
      target.setMinutes(target.getMinutes() + offset);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const want = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
      const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      return want === current;
    }
    case 'weekday': {
      const weekdays = (condition.weekdays as number[]) ?? [];
      return weekdays.includes(new Date().getDay());
    }
    case 'child_lock': {
      if (!device) return false;
      const expected = String(condition.value ?? 'LOCK').toUpperCase();
      return String(device.attributes?.child_lock ?? '').toUpperCase() === expected;
    }
    case 'open_window': {
      if (!device) return false;
      const expected = String(condition.value ?? 'ON').toUpperCase();
      const actual = device.attributes?.open_window;
      const normalized = typeof actual === 'boolean' ? (actual ? 'ON' : 'OFF') : String(actual ?? '').toUpperCase();
      return normalized === expected;
    }
    default:
      return false;
  }
}

function conditionsPass(
  conditions: { logic?: string; items?: Record<string, unknown>[] } | null | undefined,
  devices: Device[],
): boolean {
  const items = conditions?.items ?? [];
  if (items.length === 0) return true;
  if (conditions?.logic === 'or') {
    return items.some((item) => evaluateCondition(item, devices));
  }
  return items.every((item) => evaluateCondition(item, devices));
}

function checkTimeTrigger(trigger: Record<string, unknown>): boolean {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const currentDay = now.getDay();

  if (trigger.type === 'time') return trigger.time === currentTime;
  if (trigger.type === 'weekday_time') {
    const weekdays = (trigger.weekdays as number[]) ?? [];
    return trigger.time === currentTime && weekdays.includes(currentDay);
  }
  return false;
}

function checkSensorThresholdTrigger(trigger: Record<string, unknown>, devices: Device[]): boolean {
  const type = trigger.type as string;
  const isSensor =
    type === 'sensor_threshold'
    || type === 'temperature_above' || type === 'temperature_below'
    || type === 'humidity_above' || type === 'humidity_below'
    || type === 'battery_low' || type === 'power_above';
  if (!isSensor) return false;

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
  return false;
}

async function executeAction(action: Record<string, unknown>, devices: Device[]): Promise<void> {
  const t = action.type as string;

  if (t === 'multi') {
    const items = (action.actions as Record<string, unknown>[]) ?? [];
    for (const item of items) {
      await executeAction(item, devices);
    }
    return;
  }

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
        console.warn(`[AutomationRunner] BLE-Gerät ${device.name} nicht verbunden`);
        return;
      }
      await shellyBle.switchSet(deviceId, newStatus === 'on');
      await api.toggleDevice(deviceId);
    } else {
      await api.setDeviceStatus(deviceId, newStatus);
    }
  };

  if (t === 'set_device_status') {
    const status = String(action.status ?? 'off');
    if (status === 'on' || status === 'off') {
      await executeToggle(Number(action.device_id), status);
    } else {
      await api.setDeviceStatus(Number(action.device_id), status);
    }
  } else if (t === 'toggle_device') {
    await executeToggle(Number(action.device_id), 'toggle');
  } else if (t === 'delayed_off') {
    const minutes = Number(action.minutes ?? 10);
    setTimeout(() => executeToggle(Number(action.device_id), 'off'), minutes * 60 * 1000);
  } else if (t === 'delayed_on') {
    const minutes = Number(action.minutes ?? 10);
    setTimeout(() => executeToggle(Number(action.device_id), 'on'), minutes * 60 * 1000);
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
  } else if (t === 'set_thermostat_mode') {
    const mode = String(action.mode ?? 'heat');
    if (['off', 'auto', 'heat'].includes(mode)) {
      await api.setDeviceStatus(Number(action.device_id), mode);
    }
  } else if (t === 'set_thermostat_child_lock') {
    const locked = Boolean(action.locked ?? true);
    await api.setDeviceStatus(
      Number(action.device_id),
      encodeCapStatus('child_lock', locked ? 'LOCK' : 'UNLOCK'),
    );
  } else if (t === 'set_thermostat_open_window') {
    const on = Boolean(action.enabled ?? true);
    await api.setDeviceStatus(
      Number(action.device_id),
      encodeCapStatus('open_window', on ? 'ON' : 'OFF'),
    );
  } else if (t === 'set_thermostat_calibration') {
    const val = Math.max(-12.7, Math.min(12.7, Number(action.value ?? 0)));
    await api.setDeviceStatus(
      Number(action.device_id),
      encodeCapStatus('local_temperature_calibration', String(val)),
    );
  } else if (t === 'set_thermostat_frost_protection') {
    const val = Math.max(4, Math.min(35, Number(action.value ?? 5)));
    await api.setDeviceStatus(
      Number(action.device_id),
      encodeCapStatus('frost_protection_temperature', String(val)),
    );
  } else if (t === 'activate_scene') {
    await api.activateScene(Number(action.scene_id));
  } else if (t === 'notify') {
    console.info(`[AutomationRunner] Benachrichtigung: ${action.message}`);
  }
}

function shouldFireConditionsOnly(automation: Automation, devices: Device[]): boolean {
  const items = automation.conditions?.items ?? [];
  if (items.length === 0) return false;

  const pass = conditionsPass(automation.conditions, devices);
  const wasMet = conditionsMet.get(automation.id) ?? false;

  if (!pass) {
    conditionsMet.set(automation.id, false);
    return false;
  }
  if (wasMet) return false;

  conditionsMet.set(automation.id, true);
  return true;
}

async function refreshSunCache() {
  try {
    const w = await api.getWeather();
    (globalThis as { __smarthomeSun?: { sunrise?: string | null; sunset?: string | null } }).__smarthomeSun = {
      sunrise: w.current?.sunrise ?? null,
      sunset: w.current?.sunset ?? null,
    };
  } catch { /* weather optional for sun conditions */ }
}

async function runAutomations() {
  try {
    const [automations, devices] = await Promise.all([
      api.getAutomations(),
      api.getDevices(),
    ]);

    const needsSun = automations.some((a) => {
      if (!a.enabled) return false;
      const items = a.conditions?.items ?? [];
      return items.some((i) => i.type === 'sunrise' || i.type === 'sunset');
    });
    if (needsSun) await refreshSunCache();

    const key = nowKey();

    for (const automation of automations) {
      if (!automation.enabled) continue;

      const trigger = automation.trigger as Record<string, unknown>;
      const action = automation.action as Record<string, unknown>;

      if (fired.get(automation.id) === key) continue;

      let shouldFire = false;

      if (trigger.type === 'conditions') {
        shouldFire = shouldFireConditionsOnly(automation, devices);
      } else if (trigger.type === 'time' || trigger.type === 'weekday_time') {
        shouldFire = checkTimeTrigger(trigger);
        if (shouldFire && !conditionsPass(automation.conditions, devices)) shouldFire = false;
      } else if (trigger.type === 'device_status') {
        const device = devices.find((d) => d.id === Number(trigger.device_id));
        shouldFire = !!device && device.status === trigger.status;
        if (shouldFire && !conditionsPass(automation.conditions, devices)) shouldFire = false;
      } else {
        shouldFire = checkSensorThresholdTrigger(trigger, devices);
        if (shouldFire && !conditionsPass(automation.conditions, devices)) shouldFire = false;
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
    console.warn('[AutomationRunner] Fehler beim Laden:', err);
  }
}

export function useAutomationRunner() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    runAutomations();
    intervalRef.current = setInterval(runAutomations, 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
