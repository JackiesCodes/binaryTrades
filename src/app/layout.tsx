import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://binarytrades.vercel.app"),
  title: "binaryTrades — Automated trading with risk control",
  description:
    "Connect Deriv and MetaTrader 5 accounts, run strategy bots and your own scripts, execute TradingView alerts, and enforce risk limits — from one dashboard.",
  openGraph: {
    title: "binaryTrades — Automated trading with risk control",
    description: "Strategy bots, your own scripts and TradingView alerts on Deriv and MetaTrader 5, with Risk Guard limits on every order.",
    siteName: "binaryTrades",
    type: "website",
  },
  applicationName: "binaryTrades",
  appleWebApp: { capable: true, title: "binaryTrades", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0B120F",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the notch / home indicator; padding uses env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}
