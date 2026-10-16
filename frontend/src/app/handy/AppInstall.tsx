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

function AndroidCard({ apkReady }: { apkReady: boolean }) {
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
      {apkReady ? (
        <a
          href="/downloads/smarthome.apk"
          className="inline-flex items-center min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Herunterladen
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">
          Die Datei liegt auf diesem Server noch nicht. Sie wird einmal gebaut und dann hier abgelegt.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Beim ersten Start trägst du die Adresse dieser Seite ein. Sie bleibt auf dem Handy.
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

export default function AppInstall({ apkReady }: { apkReady: boolean }) {
  const [kind, setKind] = useState<Kind>('other');

  useEffect(() => {
    setKind(detectKind());
  }, []);

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
          <AndroidCard apkReady={apkReady} />
        </>
      ) : (
        <>
          <AndroidCard apkReady={apkReady} />
          <IosCard />
        </>
      )}
    </div>
  );
}
