import type { Metadata } from "next";
import { TournamentsView } from "@/components/tournaments/tournaments-view";
import { localizedPath, type Locale } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "EWC tournaments",
    description:
      "Track Esports World Cup tournament matches, upcoming schedules, and recent community results.",
  },
  ar: {
    title: "بطولات كأس العالم للرياضات الإلكترونية",
    description: "تابع مباريات كأس العالم للرياضات الإلكترونية، الجداول القادمة، وآخر نتائج المجتمع.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const meta = META[locale];
  return buildPageMetadata({
    title: meta.title,
    description: meta.description,
    path: localizedPath("/tournaments/ewc", locale),
    locale,
  });
}

export default async function EwcTournamentsPage() {
  const locale = await getRequestLocale();
  return <TournamentsView locale={locale} ewcOnly />;
}
