import type { Metadata } from "next";

import { NewsHubView } from "@/components/news/news-hub-view";
import { localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "EWC news",
    description:
      "Follow Esports World Cup community updates, prediction news, tournament notes, and game coverage.",
  },
  ar: {
    title: "\u0623\u062e\u0628\u0627\u0631 \u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645 \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629",
    description:
      "\u062a\u0627\u0628\u0639 \u0623\u062e\u0628\u0627\u0631 \u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645 \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629\u060c \u0627\u0644\u062a\u0648\u0642\u0639\u0627\u062a\u060c \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a\u060c \u0648\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0623\u0644\u0639\u0627\u0628.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const meta = META[locale];
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: localizedPath("/news/ewc", locale),
    locale,
  });
}

export default async function EwcNewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const locale = await getRequestLocale();
  const sp = await searchParams;
  const page = Math.min(10_000, Math.max(1, Number(sp?.page) || 1));
  return <NewsHubView locale={locale} ewcOnly page={page} />;
}
