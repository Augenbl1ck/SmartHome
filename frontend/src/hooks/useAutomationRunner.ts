'use client';

/**
 * Client-seitiger Automation-Runner
 *
 * Läuft im Browser solange die Seite offen ist.
 * Prüft jede Minute ob eine Automation ausgelöst werden soll.
 *
 * Unterstützte Trigger:
 *   - time           → täglich um HH:MM
 *   - weekday_time   → bestimmte Wochentage um HH:MM
 *   - device_status  → wenn ein Gerät einen bestimmten Status hat
 *
 * Unterstützte Aktionen:
 *   - set_device_status → Gerät ein-/ausschalten
 *   - toggle_device     → Gerät umschalten
 *   - delayed_off       → nach X Minuten ausschalten
 *   - delayed_on        → nach X Minuten einschalten
 *
 * BLE-Geräte: Befehl wird direkt per Bluetooth gesendet.
 * MQTT/API-Geräte: Befehl wird über das Backend gesendet.
 *
 * Limitierung: Läuft nur wenn der Browser-Tab offen ist.
 * Server-seitige Ausführung kommt in Phase 4 (Laravel Scheduler).
 */

import { useEffect, useRef } from 'react';
import { api, Automation, Device } from '@/lib/api';
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
      // Status in DB aktualisieren
      await api.toggleDevice(deviceId);
      console.info(`[AutomationRunner] BLE ${device.name} → ${newStatus}`);
    } else {
      await api.updateDevice(deviceId, { status: newStatus });
      console.info(`[AutomationRunner] API ${device.name} → ${newStatus}`);
    }
  };

  if (t === 'set_device_status') {
    await executeToggle(Number(action.device_id), action.status as 'on' | 'off');
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
    const roomDevices = devices.filter((d) => d.room_id === Number(action.room_id));
    for (const d of roomDevices) {
      await executeToggle(d.id, action.status as 'on' | 'off');
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
      const firedKey = `${automation.id}:${key}`;

      // Schon in dieser Minute gefeuert? Überspringen
      if (fired.get(automation.id) === key) continue;

      let shouldFire = false;

      if (trigger.type === 'time' || trigger.type === 'weekday_time') {
        shouldFire = checkTimeTrigger(trigger);
      } else if (trigger.type === 'device_status') {
        shouldFire = checkDeviceStatusTrigger(trigger, devices);
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
