import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import NavBar from "@/components/NavBar";
import AutomationRunnerProvider from "@/components/AutomationRunnerProvider";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
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
    <html lang="de" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NavBar />
        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full pb-24 md:pb-8">
          {children}
        </main>
        <AutomationRunnerProvider />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}



