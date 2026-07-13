import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { AnalyticsTracker } from "@/components/analytics/analytics-tracker";
import { DeploymentUpdateAlert } from "@/components/deployment-update-alert";
import { Providers } from "@/components/providers";
import { RouteFreshnessGuard } from "@/components/route-freshness-guard";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDeploymentVersion } from "@/lib/deployment-version";
import { copy, directionForLocale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import {
  absoluteUrl,
  alternateLanguages,
  googleSiteVerification,
  SITE_NAME,
  SITE_NAME_AR,
  siteDescription,
  siteIconUrl,
  siteKeywords,
  siteName,
} from "@/lib/metadata";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const name = siteName(locale);
  const description = siteDescription(locale);
  const verification = googleSiteVerification();
  return {
    metadataBase: new URL(absoluteUrl()),
    applicationName: name,
    title: {
      default: name,
      template: `%s | ${name}`,
    },
    description,
    keywords: siteKeywords(locale),
    category: "esports",
    creator: name,
    publisher: name,
    alternates: {
      languages: alternateLanguages("/"),
      types: {
        "application/rss+xml": absoluteUrl(locale === "ar" ? "/feed-ar.xml" : "/feed.xml"),
      },
    },
    icons: {
      icon: "/icon.svg",
      apple: "/apple-icon.png",
    },
    openGraph: {
      type: "website",
      siteName: name,
      title: name,
      description,
      url: absoluteUrl(),
      images: [{ url: siteIconUrl(), alt: name }],
    },
    twitter: {
      card: "summary",
      title: name,
      description,
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

function siteStructuredData(locale: "en" | "ar") {
  const url = absoluteUrl();
  const organizationId = `${url}/#organization`;
  const name = siteName(locale);
  const description = siteDescription(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name,
        alternateName: [SITE_NAME, SITE_NAME_AR],
        url,
        logo: siteIconUrl(),
      },
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        name,
        url,
        description,
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
  const deploymentVersion = getDeploymentVersion();
  return (
    <html lang={locale} dir={directionForLocale(locale)} suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full" suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(siteStructuredData(locale)) }}
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
            <Suspense fallback={null}>
              <RouteFreshnessGuard />
            </Suspense>
            <Suspense fallback={null}>
              <AnalyticsTracker />
            </Suspense>
            <DeploymentUpdateAlert initialVersion={deploymentVersion} locale={locale} />
          </Providers>
        </div>
      </body>
    </html>
  );
}
