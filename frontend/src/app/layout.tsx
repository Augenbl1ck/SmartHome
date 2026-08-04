import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import NavBar from "@/components/NavBar";
import AutomationRunnerProvider from "@/components/AutomationRunnerProvider";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import PinLockProvider from "@/components/PinLockProvider";
import AutomationNotifications from "@/components/AutomationNotifications";
import KioskProvider from "@/components/KioskProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
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
              if (en && has) {
                var d = document.createElement('div');
                d.id = 'pin-blocker';
                d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#09090b';
                document.documentElement.appendChild(d);
              }
            } catch(e) {}
          })();
        `}} /></head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <KioskProvider>
          <PinLockProvider>
            <NavBar />
            <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full pb-24 md:pb-8">
              {children}
            </main>
            <AutomationRunnerProvider />
            <AutomationNotifications />
            <ServiceWorkerRegistrar />
            <Toaster position="bottom-right" richColors closeButton />
          </PinLockProvider>
        </KioskProvider>
      </body>
    </html>
  );
}



