import type { Metadata, Viewport } from "next";
import AutomationRunnerProvider from "@/components/AutomationRunnerProvider";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import PinLockProvider from "@/components/PinLockProvider";
import AutomationNotifications from "@/components/AutomationNotifications";
import AppShell from "@/components/AppShell";
import KioskProvider from "@/components/KioskProvider";
import VirtualKeyboardProvider from "@/components/VirtualKeyboardProvider";
import SmartHomeProvider from "@/components/SmartHomeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "SmartHome",
  description: "Smart Home Steuerung",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SmartHome",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Theme: verhindert Flash beim Laden */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var t = localStorage.getItem('smarthome_theme') || 'system';
              var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
              if (dark) document.documentElement.classList.add('dark');
            } catch(e) {}
          })();
        `}} />
        {/* PIN: verhindert Flash wenn PIN aktiv */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var en  = JSON.parse(localStorage.getItem('smarthome_pin_enabled') || 'false');
              var has = !!localStorage.getItem('smarthome_pin_hash');
              var unlocked = false;
              try { unlocked = sessionStorage.getItem('smarthome_pin_unlocked') === '1'; } catch (e) {}
              if (en && has && !unlocked) {
                var d = document.createElement('div');
                d.id = 'pin-blocker';
                d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#09090b';
                document.documentElement.appendChild(d);
              }
            } catch(e) {}
          })();
        `}} />
        {/* Kiosk: ?kiosk=1 / #kiosk sofort speichern (vor React), Autostart vom Pi */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var q = new URLSearchParams(location.search);
              var hash = (location.hash || '').replace(/^#/, '');
              var force = q.get('kiosk') === '1' || hash === 'kiosk' || hash.indexOf('kiosk=1') !== -1;
              if (force) {
                localStorage.setItem('smarthome_kiosk', 'true');
                document.documentElement.classList.add('kiosk-boot');
              }
            } catch(e) {}
          })();
        `}} /></head>
      <body className="h-full overflow-hidden font-sans">
        <PinLockProvider>
          <VirtualKeyboardProvider>
            <KioskProvider>
              <SmartHomeProvider>
              <AppShell>
                {children}
              </AppShell>
              <AutomationRunnerProvider />
              <AutomationNotifications />
              <ServiceWorkerRegistrar />
              <Toaster position="bottom-right" richColors closeButton />
              </SmartHomeProvider>
            </KioskProvider>
          </VirtualKeyboardProvider>
        </PinLockProvider>
      </body>
    </html>
  );
}
