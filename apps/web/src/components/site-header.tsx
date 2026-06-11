import { SiteHeaderClient } from "@/components/site-header-client";
import { getRequestLocale } from "@/lib/request-locale";
import { getAuthSession } from "@/lib/session";

export async function SiteHeader() {
  const session = await getAuthSession();
  const locale = await getRequestLocale();
  return <SiteHeaderClient hasSession={Boolean(session)} locale={locale} />;
}
