import type { Metadata } from "next";
import { dashboardPublicUrl } from "@/lib/env";
import { safeUrlOrUndefined } from "@/lib/safe-url";

// Centralized public-page metadata: canonical URL + OpenGraph + Twitter so shared
// links (Discord, social, search) render a meaningful card per page instead of the
// generic root title. Pure utility — safe to import from server components and
// generateMetadata().

export const SITE_NAME = "Esports Community";
export const SITE_DESCRIPTION =
  "Community esports hub for game pages, tournament coverage, news, prediction leaderboards, and Discord profile showcase.";
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

export function absoluteUrl(path?: string): string {
  const base = dashboardPublicUrl();
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function buildPageMetadata(input: {
  title: string;
  description?: string | null;
  /** Localized path, e.g. "/games/valorant". Used for the canonical + og:url. */
  path?: string;
  image?: string | null;
}): Metadata {
  const url = absoluteUrl(input.path);
  const image = safeUrlOrUndefined(input.image ?? undefined);
  const description = input.description?.trim() || undefined;
  return {
    title: input.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
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
