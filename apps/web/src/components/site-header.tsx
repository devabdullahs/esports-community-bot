import { SiteHeaderClient } from "@/components/site-header-client";
import { getAdminAccess } from "@/lib/admin";
import { getRequestLocale } from "@/lib/request-locale";

export async function SiteHeader() {
  // getAdminAccess() resolves the session internally, so derive both the
  // logged-in state and admin gating from one call (no double session fetch).
  const access = await getAdminAccess();
  const locale = await getRequestLocale();
  return (
    <SiteHeaderClient
      hasSession={Boolean(access.session)}
      isAdmin={access.allowed}
      locale={locale}
    />
  );
}
