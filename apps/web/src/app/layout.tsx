import type { Metadata } from "next";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full">
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
