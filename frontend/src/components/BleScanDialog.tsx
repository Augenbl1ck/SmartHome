'use client';

import { useState } from 'react';
import { api, Device } from '@/lib/api';
import { shellyBle } from '@/lib/bluetooth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Bluetooth, Loader2, Wifi, MonitorSmartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BleDevice { address: string; name: string | null; rssi: number }

type Mode = 'scan' | 'chrome';

interface Props {
  device: Device;
  onSaved: (updatedDevice: Device) => void;
  onClose: () => void;
}

function rssiBar(rssi: number) {
  if (rssi >= -60) return 'bg-green-500';
  if (rssi >= -75) return 'bg-yellow-500';
  return 'bg-red-500';
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export default function BleScanDialog({ device, onSaved, onClose }: Props) {
  const [mode, setMode]           = useState<Mode>('scan');

  // Pi-Scan Modus
  const [scanning, setScanning]   = useState(false);
  const [results, setResults]     = useState<BleDevice[] | null>(null);
  const [selected, setSelected]   = useState<string | null>(null);

  // Chrome Modus
  const [chromeBusy, setChromeBusy] = useState(false);
  const [chromeName, setChromeName] = useState<string | null>(null);
  const [chromeMac,  setChromeMac]  = useState('');
  const [macManual,  setMacManual]  = useState(false);

  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ── Pi BLE Bridge Scan ──────────────────────────────────────────
  const scan = async () => {
    setScanning(true);
    setResults(null);
    setSelected(null);
    setError(null);
    try {
      const data = await api.bleScan(8000);
      setResults(data.devices.sort((a, b) => b.rssi - a.rssi));
      if (data.devices.length === 0) {
        setError('Keine Geräte gefunden. Gerät in Reichweite und BLE aktiviert?');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('503') || msg.includes('nicht erreichbar') || msg.includes('fetch')) {
        // BLE Bridge nicht verfügbar → automatisch auf Chrome-Modus wechseln
        setMode('chrome');
        setError(null);
      } else {
        setError(`Scan fehlgeschlagen: ${msg}`);
      }
    } finally {
      setScanning(false);
    }
  };

  // ── Chrome Web Bluetooth ────────────────────────────────────────
  const chromePair = async () => {
    setChromeBusy(true);
    setError(null);
    setChromeName(null);
    setChromeMac('');
    setMacManual(false);
    try {
      const { mac, bleName } = await shellyBle.getDeviceMacViaPicker();
      setChromeName(bleName);
      setChromeMac(mac);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('manuell eingeben')) {
        setMacManual(true);
        setError(msg);
      } else if (!msg.includes('cancelled') && !msg.includes('User cancelled')) {
        setError(msg);
      }
    } finally {
      setChromeBusy(false);
    }
  };

  // ── MAC speichern (gemeinsam für beide Modi) ────────────────────
  const macToSave = mode === 'scan' ? (selected ?? '') : chromeMac;

  const save = async () => {
    if (!MAC_RE.test(macToSave)) {
      setError('Ungültige MAC-Adresse (Format: AA:BB:CC:DD:EE:FF)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.saveBleMac(device.id, macToSave);
      onSaved(updated);
    } catch (err) {
      setError(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="h-4 w-4" /> Gerät koppeln
          </DialogTitle>
        </DialogHeader>

        {/* Modus-Tabs */}
        <div className="flex rounded-lg border overflow-hidden text-sm">
          <button
            onClick={() => { setMode('scan'); setError(null); }}
            className={cn('flex-1 py-2 transition-colors', mode === 'scan' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
          >
            Pi BLE Bridge
          </button>
          <button
            onClick={() => { setMode('chrome'); setError(null); }}
            className={cn('flex-1 py-2 transition-colors', mode === 'chrome' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
          >
            Chrome Bluetooth
          </button>
        </div>

        <div className="space-y-3 py-1">
          {/* ── Pi-Scan Modus ── */}
          {mode === 'scan' && (
            <>
              <p className="text-sm text-muted-foreground">
                Scannt via BLE Bridge auf dem Raspberry Pi.
              </p>
              <Button onClick={scan} disabled={scanning} className="w-full"
                variant={results === null ? 'default' : 'outline'}>
                {scanning
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Scanne… (8s)</>
                  : results === null
                  ? <><Bluetooth className="h-4 w-4 mr-2" />Scan starten</>
                  : <><Bluetooth className="h-4 w-4 mr-2" />Erneut scannen</>}
              </Button>

              {results !== null && results.length > 0 && (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {results.map(d => (
                    <button key={d.address} onClick={() => setSelected(d.address)}
                      className={cn(
                        'cursor-pointer w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
                        selected === d.address ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                      )}>
                      <Bluetooth className={cn('h-4 w-4 shrink-0', selected === d.address ? 'text-primary' : 'text-muted-foreground')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.name ?? '(kein Name)'}</p>
                        <p className="text-xs text-muted-foreground font-mono">{d.address}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Wifi className="h-3 w-3 text-muted-foreground" />
                        <span className={cn('h-2 w-2 rounded-full', rssiBar(d.rssi))} />
                        <span className="text-xs text-muted-foreground">{d.rssi}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Chrome Bluetooth Modus ── */}
          {mode === 'chrome' && (
            <>
              <p className="text-sm text-muted-foreground">
                Öffnet den Chrome-Bluetooth-Dialog. Die MAC wird automatisch aus dem Gerätenamen gelesen.
              </p>

              {!chromeName ? (
                <Button onClick={chromePair} disabled={chromeBusy} className="w-full">
                  {chromeBusy
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Warte auf Auswahl…</>
                    : <><MonitorSmartphone className="h-4 w-4 mr-2" />Chrome Bluetooth öffnen</>}
                </Button>
              ) : (
                <div className="rounded-lg border bg-accent/50 px-3 py-2.5 space-y-1">
                  <p className="text-sm font-medium">{chromeName}</p>
                  <p className="text-xs font-mono text-muted-foreground">{chromeMac}</p>
                  <button onClick={() => { setChromeName(null); setChromeMac(''); setMacManual(false); }}
                    className="text-xs text-primary underline">Anderes Gerät wählen</button>
                </div>
              )}

              {macManual && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">MAC-Adresse manuell eingeben:</p>
                  <input
                    value={chromeMac}
                    onChange={e => setChromeMac(e.target.value.toUpperCase())}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    maxLength={17}
                  />
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save} disabled={!MAC_RE.test(macToSave) || saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Speichern…</> : 'Koppeln'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

