import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_ROUTE_HEADER,
  type Locale,
  isLocalePreferencePath,
  isLocaleRoutedPath,
  localeFromPathname,
  localeFromString,
  localizedPath,
  stripLocalePrefix,
} from "@/lib/i18n";

const LOCALE_FORWARD_PROOF_HEADER = "x-ec-locale-proof";
const LOCALE_FORWARD_PROOF = crypto.randomUUID();

function setLocaleCookie(response: NextResponse, locale: Locale) {
  response.cookies.set(LOCALE_COOKIE_NAME, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
}

function requestWithLocale(request: NextRequest, locale: Locale) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_ROUTE_HEADER, locale);
  requestHeaders.set(LOCALE_FORWARD_PROOF_HEADER, LOCALE_FORWARD_PROOF);
  return requestHeaders;
}

const PRIVATE_HTML_PREFIXES = ["/api", "/admin", "/login", "/me"];

export function isPublicHtmlCacheCandidate(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (!request.headers.get("accept")?.toLowerCase().includes("text/html")) return false;
  if (request.headers.has("cookie")) return false;
  if (request.nextUrl.search) return false;
  if (request.headers.get("rsc") === "1") return false;
  if (request.headers.get("next-router-prefetch") === "1") return false;
  if (
    request.headers.has(LOCALE_ROUTE_HEADER) &&
    request.headers.get(LOCALE_FORWARD_PROOF_HEADER) !== LOCALE_FORWARD_PROOF
  ) {
    return false;
  }

  const pathname = stripLocalePrefix(request.nextUrl.pathname);
  if (PRIVATE_HTML_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  const finalSegment = pathname.split("/").filter(Boolean).at(-1) || "";
  if (finalSegment.includes(".")) return false;
  return isLocaleRoutedPath(pathname);
}

function finalizePublicResponse(request: NextRequest, response: NextResponse) {
  if (isPublicHtmlCacheCandidate(request)) {
    response.headers.set(
      "Cloudflare-CDN-Cache-Control",
      "public, max-age=60, must-revalidate",
    );
  }
  return response;
}

function shouldPersistLocale(request: NextRequest) {
  return !isPublicHtmlCacheCandidate(request);
}

export function proxy(request: NextRequest) {
  const legacyLocale = localeFromString(request.nextUrl.searchParams.get("lang"));
  if (legacyLocale) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("lang");
    url.pathname = localizedPath(url.pathname, legacyLocale);
    const response = NextResponse.redirect(url);
    setLocaleCookie(response, legacyLocale);
    return response;
  }

  const routeLocale = localeFromPathname(request.nextUrl.pathname);
  if (!routeLocale) {
    // A localized rewrite can pass through the proxy again at its stripped
    // pathname. Keep the locale selected by the first pass instead of
    // replacing it with the canonical English locale.
    const forwardedLocale = request.headers.get(LOCALE_FORWARD_PROOF_HEADER) === LOCALE_FORWARD_PROOF
      ? localeFromString(request.headers.get(LOCALE_ROUTE_HEADER))
      : null;
    if (forwardedLocale) {
      return finalizePublicResponse(request, NextResponse.next({
        request: { headers: requestWithLocale(request, forwardedLocale) },
      }));
    }
    if (!isLocaleRoutedPath(request.nextUrl.pathname)) return NextResponse.next();

    const cookieLocale = localeFromString(
      request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    );
    if (cookieLocale === "ar" && isLocalePreferencePath(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = localizedPath(url.pathname, "ar");
      const response = NextResponse.redirect(url);
      setLocaleCookie(response, "ar");
      return response;
    }

    const response = NextResponse.next({
      request: { headers: requestWithLocale(request, "en") },
    });
    if (shouldPersistLocale(request)) setLocaleCookie(response, "en");
    return finalizePublicResponse(request, response);
  }

  const url = request.nextUrl.clone();
  url.pathname = stripLocalePrefix(url.pathname);

  if (!isLocaleRoutedPath(url.pathname)) {
    const response = NextResponse.redirect(url);
    setLocaleCookie(response, routeLocale);
    return response;
  }

  const response = NextResponse.rewrite(url, {
    request: { headers: requestWithLocale(request, routeLocale) },
  });
  if (shouldPersistLocale(request)) setLocaleCookie(response, routeLocale);
  return finalizePublicResponse(request, response);
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
