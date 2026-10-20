'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { api, type Device } from '@/lib/api';

type Kind = 'android' | 'ios' | 'other';

function detectKind(): Kind {
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadOs) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

type AddressBridge = {
  getHome: () => string;
  getAway: () => string;
  setHome: (value: string) => void;
  setAway: (value: string) => void;
  getWatchDevices?: () => string;
  setWatchDevices?: (value: string) => void;
};

function addressBridge(): AddressBridge | null {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { SmartHomeAddress?: AddressBridge }).SmartHomeAddress;
  return value ?? null;
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function AddressFields() {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const bridge = addressBridge();
    if (!bridge) return;
    setHome(bridge.getHome().replace(/^https?:\/\//i, ''));
    setAway(bridge.getAway().replace(/^https?:\/\//i, ''));
  }, []);

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <label htmlFor="app-home" className="text-sm text-muted-foreground">Zu Hause, im WLAN</label>
        <input
          id="app-home"
          value={home}
          onChange={(event) => setHome(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full min-h-11 rounded-xl border border-input bg-background px-3 text-sm"
        />
      </div>
      <div>
        <label htmlFor="app-away" className="text-sm text-muted-foreground">Unterwegs, über Tailscale</label>
        <input
          id="app-away"
          value={away}
          onChange={(event) => setAway(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full min-h-11 rounded-xl border border-input bg-background px-3 text-sm"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          const bridge = addressBridge();
          if (!bridge) return;
          bridge.setHome(normalizeAddress(home));
          bridge.setAway(normalizeAddress(away));
          setNote('Gespeichert. Gilt beim nächsten Öffnen.');
        }}
        className="cursor-pointer inline-flex items-center min-h-11 rounded-xl bg-muted px-4 text-sm font-medium"
      >
        Speichern
      </button>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function WatchDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    const bridge = addressBridge();
    const raw = bridge?.getWatchDevices?.() ?? '';
    setSelected(raw.split(',').map((part) => Number(part)).filter((id) => id > 0));
    api.getDevices().then(setDevices).catch(() => setDevices([]));
  }, []);

  const toggle = (id: number) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    setSelected(next);
    addressBridge()?.setWatchDevices?.(next.join(','));
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium">Auf der Uhr</p>
      <p className="text-sm text-muted-foreground">Diese Geräte erscheinen auf der Galaxy Watch.</p>
      {devices.map((device) => (
        <label key={device.id} className="flex items-center gap-3 min-h-11 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(device.id)}
            onChange={() => toggle(device.id)}
            className="h-5 w-5 rounded accent-primary"
          />
          <span className="truncate">{device.name}</span>
        </label>
      ))}
    </div>
  );
}

function AndroidCard({
  apkReady,
  updateReady,
  inApp,
}: {
  apkReady: boolean;
  updateReady: boolean;
  inApp: boolean | null;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Smartphone className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Android</h2>
          <p className="text-sm text-muted-foreground">Datei von dieser Seite, nicht aus dem Play Store.</p>
        </div>
      </div>
      {apkReady && updateReady ? (
        <a
          href="/downloads/smarthome.apk"
          className="inline-flex items-center min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Aktualisieren
        </a>
      ) : apkReady && inApp === false ? (
        <a
          href="/downloads/smarthome.apk"
          className="inline-flex items-center min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Herunterladen
        </a>
      ) : apkReady && inApp == null ? null : apkReady && inApp ? (
        <p className="text-sm text-muted-foreground">Die App ist aktuell.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Die Datei liegt auf diesem Server noch nicht. Sie wird einmal gebaut und dann hier abgelegt.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Beim ersten Start trägst du die Adresse für zu Hause und die für unterwegs ein. Beide bleiben auf dem Handy.
      </p>
      {inApp ? <AddressFields /> : null}
      {inApp ? <WatchDevices /> : null}
    </section>
  );
}

function WatchCard({ watchReady }: { watchReady: boolean }) {
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-3">
      <h2 className="text-base font-semibold">Galaxy Watch</h2>
      <p className="text-sm text-muted-foreground">
        Die Uhr schaltet nur die Geräte, die in der App unter „Auf der Uhr“ markiert sind. Installieren per adb oder Galaxy Wearable.
      </p>
      {watchReady ? (
        <a
          href="/downloads/smarthome-watch.apk"
          className="inline-flex items-center min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Uhr-Datei herunterladen
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">Die Uhr-Datei liegt auf diesem Server noch nicht.</p>
      )}
    </section>
  );
}

function IosCard() {
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Smartphone className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-base font-semibold">iPhone</h2>
          <p className="text-sm text-muted-foreground">Über Safari auf den Home-Bildschirm.</p>
        </div>
      </div>
      <ol className="list-decimal pl-5 space-y-1 text-sm">
        <li>Diese Seite in Safari öffnen.</li>
        <li>Auf Teilen tippen.</li>
        <li>Zum Home-Bildschirm wählen.</li>
      </ol>
    </section>
  );
}

export default function AppInstall({
  apkReady,
  watchReady,
  versionCode,
}: {
  apkReady: boolean;
  watchReady: boolean;
  versionCode: number;
}) {
  const [kind, setKind] = useState<Kind>('other');
  const [installed, setInstalled] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setKind(detectKind());
    const match = navigator.userAgent.match(/SmartHomeAndroid\/(\d+)/);
    setInstalled(match ? Number(match[1]) : null);
    setReady(true);
  }, []);

  const updateReady = installed != null && versionCode > installed;
  const inApp = ready ? installed != null : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="h-14 w-14 rounded-full bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-all"
          aria-label="Zurück"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">App</h1>
      </div>
      {kind === 'ios' ? (
        <>
          <IosCard />
          <AndroidCard apkReady={apkReady} updateReady={updateReady} inApp={inApp} />
          <WatchCard watchReady={watchReady} />
        </>
      ) : (
        <>
          <AndroidCard apkReady={apkReady} updateReady={updateReady} inApp={inApp} />
          <WatchCard watchReady={watchReady} />
          <IosCard />
        </>
      )}
    </div>
  );
}
