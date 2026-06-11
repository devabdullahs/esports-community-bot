export const DEFAULT_SEASON = "2026";

export function defaultPublicGuildId() {
  if (process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID) {
    return process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID;
  }
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

export function internalSecret() {
  return process.env.EWC_DASHBOARD_INTERNAL_SECRET || "";
}

export function trustedOrigins() {
  return [
    dashboardPublicUrl(),
    process.env.BETTER_AUTH_URL,
    process.env.EWC_DASHBOARD_PUBLIC_URL,
  ].filter(Boolean) as string[];
}
