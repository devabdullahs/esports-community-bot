import { TournamentsView } from "@/components/tournaments/tournaments-view";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EwcTournamentsPage() {
  const locale = await getRequestLocale();
  return <TournamentsView locale={locale} ewcOnly />;
}
