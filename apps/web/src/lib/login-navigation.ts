import { localizedPath, stripLocalePrefix, type Locale } from "@/lib/i18n";

const CALLBACK_MAX_LENGTH = 2_048;
const DUMMY_ORIGIN = "https://login.local";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const ENCODED_ROUTE_DELIMITER = /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/iu;
const MAX_DECODE_PASSES = 3;

function fallback(locale: Locale) {
  return localizedPath("/me", locale);
}

function isBlockedRoute(pathname: string) {
  const normalized = stripLocalePrefix(pathname);
  return normalized === "/api" || normalized.startsWith("/api/") || normalized === "/login" || normalized.startsWith("/login/");
}

function decodePathname(pathname: string) {
  let decoded = pathname;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return next;
      decoded = next;
    } catch {
      return null;
    }
  }

  try {
    return decodeURIComponent(decoded) === decoded ? decoded : null;
  } catch {
    return null;
  }
}

/** Returns a localized, same-site callback path or the localized profile fallback. */
export function loginCallbackUrl(value: string | null | undefined, locale: Locale) {
  if (!value || value.length > CALLBACK_MAX_LENGTH || value !== value.trim()) return fallback(locale);
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || CONTROL_CHARACTER.test(value)) {
    return fallback(locale);
  }

  const suffixIndex = value.search(/[?#]/);
  const rawPathname = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  if (!rawPathname || ENCODED_ROUTE_DELIMITER.test(rawPathname) || isBlockedRoute(rawPathname)) {
    return fallback(locale);
  }

  const decodedPathname = decodePathname(rawPathname);
  if (!decodedPathname || decodedPathname.includes("\\") || CONTROL_CHARACTER.test(decodedPathname)) {
    return fallback(locale);
  }

  try {
    const parsed = new URL(value, DUMMY_ORIGIN);
    const canonical = new URL(decodedPathname, DUMMY_ORIGIN);
    if (parsed.origin !== DUMMY_ORIGIN || canonical.origin !== DUMMY_ORIGIN || isBlockedRoute(canonical.pathname)) {
      return fallback(locale);
    }
    return localizedPath(`${parsed.pathname}${parsed.search}${parsed.hash}`, locale);
  } catch {
    return fallback(locale);
  }
}
