import type { Metadata } from "next";
import { dashboardPublicUrl } from "@/lib/env";
import {
  localeFromPathname,
  localizedPath,
  stripLocalePrefix,
  type Locale,
} from "@/lib/i18n";
import { isProxiableLogoUrl, logoProxyUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";

// Centralized public-page metadata: canonical URL + OpenGraph + Twitter so shared
// links (Discord, social, search) render a meaningful card per page instead of the
// generic root title. Pure utility — safe to import from server components and
// generateMetadata().

export const SITE_NAME = "Esports Community";
export const SITE_NAME_AR =
  "\u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629";
export const SITE_DESCRIPTION =
  "Community esports hub for game pages, tournament coverage, news, prediction leaderboards, and Discord profile showcase.";
export const SITE_DESCRIPTION_AR =
  "\u0645\u0646\u0635\u0629 \u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629 \u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0648\u0627\u0644\u0623\u062e\u0628\u0627\u0631 \u0648\u0644\u0648\u062d\u0627\u062a \u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a \u0648\u0631\u0628\u0637 \u0645\u0644\u0641 \u062f\u064a\u0633\u0643\u0648\u0631\u062f.";
export const SITE_KEYWORDS = [
  "esports",
  "esports community",
  "EWC",
  "Esports World Cup",
  "gaming community",
  "tournament tracking",
  "prediction leaderboard",
  "Discord esports bot",
];
export const SITE_KEYWORDS_AR = [
  "\u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
  "\u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
  "\u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645 \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
  "\u0628\u0637\u0648\u0644\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628",
  "\u0623\u062e\u0628\u0627\u0631 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
  "\u062a\u0648\u0642\u0639\u0627\u062a \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a",
  "\u0628\u0648\u062a \u062f\u064a\u0633\u0643\u0648\u0631\u062f \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
];

export function siteName(locale: Locale = "en") {
  return locale === "ar" ? SITE_NAME_AR : SITE_NAME;
}

export function siteDescription(locale: Locale = "en") {
  return locale === "ar" ? SITE_DESCRIPTION_AR : SITE_DESCRIPTION;
}

export function siteKeywords(locale: Locale = "en") {
  return locale === "ar" ? SITE_KEYWORDS_AR : SITE_KEYWORDS;
}

export function absoluteUrl(path?: string): string {
  const base = dashboardPublicUrl();
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function alternateLanguages(path = "/") {
  const cleanPath = stripLocalePrefix(path);
  const en = absoluteUrl(cleanPath);
  return {
    en,
    ar: absoluteUrl(localizedPath(cleanPath, "ar")),
    "x-default": en,
  };
}

export function languageAlternates(
  paths: Partial<Record<Locale | "x-default", string>>,
) {
  return Object.fromEntries(
    Object.entries(paths).map(([locale, path]) => [locale, absoluteUrl(path)]),
  );
}

// Liquipedia forbids hotlinking, and og:image is fetched by social crawlers, so
// a Liquipedia entity image must be served through our caching proxy as an
// absolute URL. PandaScore CDN images (and any other host) pass through as-is.
function ogImageUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return isProxiableLogoUrl(raw) ? absoluteUrl(logoProxyUrl(raw)) : raw;
}

export function buildPageMetadata(input: {
  title: string;
  description?: string | null;
  /** Localized path, e.g. "/games/valorant". Used for the canonical + og:url. */
  path?: string;
  image?: string | null;
  locale?: Locale;
  languagePaths?: Partial<Record<Locale | "x-default", string>>;
  robots?: Metadata["robots"];
}): Metadata {
  const locale = input.locale ?? localeFromPathname(input.path ?? "") ?? "en";
  const url = absoluteUrl(input.path);
  const image = ogImageUrl(safeUrlOrUndefined(input.image ?? undefined));
  const description = input.description?.trim() || siteDescription(locale);
  const name = siteName(locale);
  return {
    title: input.title,
    description,
    alternates: {
      canonical: url,
      languages: input.languagePaths
        ? languageAlternates(input.languagePaths)
        : alternateLanguages(input.path),
      types: {
        "application/rss+xml": absoluteUrl(locale === "ar" ? "/feed-ar.xml" : "/feed.xml"),
      },
    },
    openGraph: {
      type: "website",
      siteName: name,
      title: input.title,
      description,
      url,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: input.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
    ...(input.robots ? { robots: input.robots } : {}),
  };
}

export function googleSiteVerification() {
  return (
    process.env.EWC_GOOGLE_SITE_VERIFICATION ||
    process.env.GOOGLE_SITE_VERIFICATION ||
    ""
  ).trim();
}

export function siteIconUrl() {
  return absoluteUrl("/icon.svg");
}
