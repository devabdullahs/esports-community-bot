import type { Metadata } from "next";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { directionForLocale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Esports Community",
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
