import { resolveDefaultGuildId } from "@/lib/guild";

// Back-compat constant; new default links should prefer currentSeason() so they
// track the calendar year instead of a hardcoded one.
export const DEFAULT_SEASON = "2026";

// Season ids are the four-digit year. Defaulting to the current year keeps
// generated leaderboard links pointing at the live season without a config bump.
export function currentSeason() {
  return String(new Date().getFullYear());
}

export async function defaultPublicGuildId() {
  // Delegate to the DB-derived resolver (env override still wins inside it) so
  // every existing caller works without EWC_DASHBOARD_DEFAULT_GUILD_ID set.
  const resolved = await resolveDefaultGuildId();
  if (resolved) return resolved;
  return process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS === "true"
    ? "demo-guild"
    : "";
}

export function dashboardPublicUrl() {
  return (
    process.env.EWC_DASHBOARD_PUBLIC_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export type InternalCapability = "profile-sync" | "news-revalidate";

export function internalCapabilitySecret(capability: InternalCapability) {
  if (capability === "profile-sync") {
    return process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET || "";
  }
  return process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET || "";
}

export function trustedOrigins() {
  return [
    dashboardPublicUrl(),
    process.env.BETTER_AUTH_URL,
    process.env.EWC_DASHBOARD_PUBLIC_URL,
  ].filter(Boolean) as string[];
}
