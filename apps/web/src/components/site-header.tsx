import { SiteHeaderClient } from "@/components/site-header-client";
import { getAuthSession } from "@/lib/session";

export async function SiteHeader() {
  const session = await getAuthSession();
  return <SiteHeaderClient hasSession={Boolean(session)} />;
}
