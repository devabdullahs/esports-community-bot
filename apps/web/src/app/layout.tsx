import type { Metadata } from "next";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { copy, directionForLocale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import {
  absoluteUrl,
  googleSiteVerification,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  siteIconUrl,
} from "@/lib/metadata";
import "./globals.css";

export function generateMetadata(): Metadata {
  const verification = googleSiteVerification();
  return {
    metadataBase: new URL(absoluteUrl()),
    applicationName: SITE_NAME,
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS,
    category: "esports",
    creator: SITE_NAME,
    publisher: SITE_NAME,
    icons: {
      icon: "/icon.svg",
      apple: "/apple-icon.png",
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: absoluteUrl(),
      images: [{ url: siteIconUrl(), alt: SITE_NAME }],
    },
    twitter: {
      card: "summary",
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      images: [siteIconUrl()],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    ...(verification ? { verification: { google: verification } } : {}),
  };
}

function siteStructuredData() {
  const url = absoluteUrl();
  const organizationId = `${url}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        url,
        logo: siteIconUrl(),
      },
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        name: SITE_NAME,
        url,
        description: SITE_DESCRIPTION,
        inLanguage: ["en", "ar"],
        publisher: { "@id": organizationId },
      },
    ],
  };
}

function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={directionForLocale(locale)} suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full" suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(siteStructuredData()) }}
        />
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
