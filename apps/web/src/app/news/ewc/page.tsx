import type { Metadata } from "next";
import { NewsHubView } from "@/components/news/news-hub-view";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "EWC news",
    description:
      "Follow Esports World Cup community updates, prediction news, tournament notes, and game coverage.",
    path: "/news/ewc",
  });
}

export default async function EwcNewsPage() {
  const locale = await getRequestLocale();
  return <NewsHubView locale={locale} ewcOnly />;
}
