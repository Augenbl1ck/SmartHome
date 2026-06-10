import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { Home, Settings, Zap } from "lucide-react";
import AutomationRunnerProvider from "@/components/AutomationRunnerProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SmartHome",
  description: "Smart Home Steuerung",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b px-6 py-3 flex items-center gap-6">
          <span className="font-bold text-lg">🏠 SmartHome</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="flex items-center gap-1 hover:text-primary">
              <Home className="h-4 w-4" /> Dashboard
            </Link>
            <Link href="/automations" className="flex items-center gap-1 hover:text-primary">
              <Zap className="h-4 w-4" /> Automationen
            </Link>
            <Link href="/settings" className="flex items-center gap-1 hover:text-primary">
              <Settings className="h-4 w-4" /> Einstellungen
            </Link>
          </nav>
        </header>
        <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
        <AutomationRunnerProvider />
      </body>
    </html>
  );
}


