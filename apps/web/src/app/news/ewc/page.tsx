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
    title: "أخبار كأس العالم للرياضات الإلكترونية",
    description:
      "تابع أخبار كأس العالم للرياضات الإلكترونية، التوقعات، ملاحظات البطولات، وتغطية الألعاب.",
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

export default async function EwcNewsPage() {
  const locale = await getRequestLocale();
  return <NewsHubView locale={locale} ewcOnly />;
}
