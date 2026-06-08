export const DEFAULT_SEASON = "2026";

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
