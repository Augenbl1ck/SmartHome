'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Smartphone } from 'lucide-react';

type Kind = 'android' | 'ios' | 'other';

function detectKind(): Kind {
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadOs) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
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

export default function AppInstall({ apkReady, versionCode }: { apkReady: boolean; versionCode: number }) {
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
        </>
      ) : (
        <>
          <AndroidCard apkReady={apkReady} updateReady={updateReady} inApp={inApp} />
          <IosCard />
        </>
      )}
    </div>
  );
}
