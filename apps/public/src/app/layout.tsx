import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Navigation } from "@/components/navigation";
import { PollingProvider } from "@/lib/polling-context";
import { SelectionProvider } from "@/lib/selection-context";
import VersionBadge from "@/components/version-badge";
import { GoogleTagManager } from "@next/third-parties/google";

// Fonts are vendored in ./fonts (see fonts/README.md) so builds do not depend
// on Google Fonts, whose responses intermittently break next/font/google.
const dmSans = localFont({
  src: "./fonts/dm-sans-latin-wght-normal.woff2",
  variable: "--font-geist-sans",
  weight: "100 1000",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fiber Service Map",
  description: "Check fiber internet service availability in your area",
  appleWebApp: {
    title: 'Fiber Service Map',
    statusBarStyle: 'black-translucent',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      {process.env.NEXT_PUBLIC_GTM_ID && (
        <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID} />
      )}
      <body
        className={`${dmSans.variable} ${jetbrainsMono.variable} antialiased min-h-screen`}
      >
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${process.env.NEXT_PUBLIC_GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        )}
        <SelectionProvider>
          <PollingProvider>
            <div className="flex min-h-screen flex-col">
              <Navigation />
              <main>
                {children}
              </main>
              <VersionBadge />
            </div>
            <Toaster />
          </PollingProvider>
        </SelectionProvider>
      </body>
    </html>
  );
}
