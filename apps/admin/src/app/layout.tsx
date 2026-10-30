import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Navigation } from "@/components/navigation";
import { PollingProvider } from "@/lib/polling-context";
import { SelectionProvider } from "@/lib/selection-context";
import VersionBadge from "@/components/version-badge";

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
  title: "Fiber Service Mapper",
  description: "Map and check fiber internet service availability across addresses",
  appleWebApp: {
    title: 'Fiber Service Mapper',
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
      <body
        className={`${dmSans.variable} ${jetbrainsMono.variable} antialiased min-h-screen`}
      >
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
