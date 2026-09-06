import { SiteHeaderClient } from "@/components/site-header-client";
import { getAdminAccess } from "@/lib/admin";
import { countLiveCoStreams } from "@/lib/public-co-streams";
import { getRequestLocale } from "@/lib/request-locale";

export async function SiteHeader() {
  // getAdminAccess() resolves the session internally, so derive both the
  // logged-in state and admin gating from one call (no double session fetch).
  // Live co-stream count for the nav badge. 30s-cached; a status hiccup must
  // never take the header down, so failures just render no badge.
  const [access, locale, liveCoStreams] = await Promise.all([
    getAdminAccess(),
    getRequestLocale(),
    countLiveCoStreams().catch(() => 0),
  ]);
  return (
    <SiteHeaderClient
      hasSession={Boolean(access.session)}
      isAdmin={access.allowed}
      locale={locale}
      liveCoStreams={liveCoStreams}
    />
  );
}
