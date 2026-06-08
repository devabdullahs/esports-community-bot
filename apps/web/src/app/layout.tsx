import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansArabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
});

export const metadata: Metadata = {
  title: "EWC Predictions",
  description: "EWC prediction leaderboard and Discord profile showcase.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansArabic.variable} h-full antialiased`}
    >
      <body>
        <div className="app-root flex min-h-full flex-col">
          <Providers>
            <Suspense fallback={null}>
              <SiteHeader />
            </Suspense>
            <div className="flex flex-1 flex-col">{children}</div>
            <Suspense fallback={null}>
              <SiteFooter />
            </Suspense>
          </Providers>
        </div>
      </body>
    </html>
  );
}
