import type { Metadata } from "next";
import { LiveMatchCenter } from "@/components/live/live-match-center";
import { copy, localizedPath } from "@/lib/i18n";
import { getLiveMatchCenter } from "@/lib/live-match-center";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const text = copy[locale].live;
  return buildPageMetadata({
    title: text.title,
    description: text.description,
    path: localizedPath("/live", locale),
    locale,
  });
}

export default async function LivePage() {
  const locale = await getRequestLocale();
  return <LiveMatchCenter initialData={await getLiveMatchCenter()} locale={locale} />;
}
