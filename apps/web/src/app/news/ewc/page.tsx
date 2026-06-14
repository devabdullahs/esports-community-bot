import { NewsHubView } from "@/components/news/news-hub-view";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EwcNewsPage() {
  const locale = await getRequestLocale();
  return <NewsHubView locale={locale} ewcOnly />;
}
