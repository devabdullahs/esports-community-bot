import type { Metadata } from "next";
import { TournamentsView } from "@/components/tournaments/tournaments-view";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Tracked esports tournaments",
    description:
      "Browse live, upcoming, and recent matches from the esports tournaments tracked by the community.",
    path: "/tournaments",
  });
}

export default async function TournamentsPage() {
  const locale = await getRequestLocale();
  return <TournamentsView locale={locale} />;
}
