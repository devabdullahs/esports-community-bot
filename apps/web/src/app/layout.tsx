import type { Metadata } from "next";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { copy, directionForLocale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { absoluteUrl, SITE_NAME } from "@/lib/metadata";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl()),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Community esports hub for game pages, news, prediction boards, and Discord profile showcase.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={directionForLocale(locale)} suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full" suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:border focus-visible:bg-background focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copy[locale].common.skipToContent}
        </a>
        <div className="app-root flex min-h-full flex-col">
          <Providers>
            <Suspense fallback={null}>
              <SiteHeader />
            </Suspense>
            <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
              {children}
            </div>
            <Suspense fallback={null}>
              <SiteFooter />
            </Suspense>
          </Providers>
        </div>
      </body>
    </html>
  );
}
