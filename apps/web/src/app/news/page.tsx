import type { Metadata } from "next";
import { NewsHubView } from "@/components/news/news-hub-view";
import { localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Esports community news",
    description:
      "Read the latest community esports updates, match coverage, tournament notes, and game-specific posts.",
  },
  ar: {
    title: "أخبار مجتمع الرياضات الإلكترونية",
    description:
      "تابع آخر أخبار مجتمع الرياضات الإلكترونية، تغطية المباريات، ملاحظات البطولات، ومنشورات الألعاب.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const meta = META[locale];
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: localizedPath("/news", locale),
    locale,
  });
}

export default async function NewsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const locale = await getRequestLocale();
  const sp = await searchParams;
  const page = Number(sp?.page) || 1;
  return <NewsHubView locale={locale} page={page} />;
}
