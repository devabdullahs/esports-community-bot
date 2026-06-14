import type { Metadata } from "next";
import { NewsHubView } from "@/components/news/news-hub-view";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Esports community news",
    description:
      "Read the latest community esports updates, match coverage, tournament notes, and game-specific posts.",
    path: "/news",
  });
}

export default async function NewsHubPage() {
  const locale = await getRequestLocale();
  return <NewsHubView locale={locale} />;
}
