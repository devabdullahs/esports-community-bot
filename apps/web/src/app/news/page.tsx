import type { Metadata } from "next";

import { NewsHubView } from "@/components/news/news-hub-view";
import { type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";
import { hasNonTrackingQuery, paginatedPath, parsePublicPage } from "@/lib/seo-query";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Esports community news",
    description:
      "Read the latest community esports updates, match coverage, tournament notes, and game-specific posts.",
  },
  ar: {
    title: "\u0623\u062e\u0628\u0627\u0631 \u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
    description:
      "\u062a\u0627\u0628\u0639 \u0622\u062e\u0631 \u0623\u062e\u0628\u0627\u0631 \u0645\u062c\u062a\u0645\u0639 \u0627\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629\u060c \u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a\u060c \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a\u060c \u0648\u0645\u0646\u0634\u0648\u0631\u0627\u062a \u0627\u0644\u0623\u0644\u0639\u0627\u0628.",
  },
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const page = parsePublicPage(params.page);
  if (page === null) return { robots: { index: false, follow: true } };
  const meta = META[locale];
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: paginatedPath("/news", locale, page),
    locale,
    robots: hasNonTrackingQuery(params, new Set(["page"]))
      ? { index: false, follow: true }
      : undefined,
  });
}

export default async function NewsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const sp = await searchParams;
  const page = parsePublicPage(sp.page);
  if (page === null) notFound();
  return <NewsHubView locale={locale} page={page} />;
}
