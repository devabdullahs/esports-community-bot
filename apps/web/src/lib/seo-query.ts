import { localizedPath, type Locale } from "@/lib/i18n";

export const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);

export function parsePublicPage(value: string | string[] | undefined, max = 10_000) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return 1;
  if (!/^\d+$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= max ? page : null;
}

export function paginatedPath(basePath: string, locale: Locale, page: number) {
  const localized = localizedPath(basePath, locale);
  return page > 1 ? `${localized}?page=${page}` : localized;
}

export function hasNonTrackingQuery(
  params: Record<string, string | string[] | undefined>,
  allowed = new Set<string>(),
) {
  return Object.keys(params).some(
    (key) => !allowed.has(key) && !TRACKING_QUERY_KEYS.has(key),
  );
}
