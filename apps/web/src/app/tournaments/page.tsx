import type { Metadata } from "next";
import { TournamentsView } from "@/components/tournaments/tournaments-view";
import { copy, localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = copy[locale].tournaments;
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/tournaments", locale),
    locale,
  });
}

export default async function TournamentsPage() {
  const locale = await getRequestLocale();
  return <TournamentsView locale={locale} />;
}
