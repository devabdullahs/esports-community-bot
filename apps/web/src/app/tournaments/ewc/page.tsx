import type { Metadata } from "next";
import { TournamentsView } from "@/components/tournaments/tournaments-view";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "EWC tournaments",
    description:
      "Track Esports World Cup tournament matches, upcoming schedules, and recent community results.",
    path: "/tournaments/ewc",
  });
}

export default async function EwcTournamentsPage() {
  const locale = await getRequestLocale();
  return <TournamentsView locale={locale} ewcOnly />;
}
