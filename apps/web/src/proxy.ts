import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_ROUTE_HEADER,
  type Locale,
  isLocaleRoutedPath,
  localeFromPathname,
  localeFromString,
  localizedPath,
  stripLocalePrefix,
} from "@/lib/i18n";

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
  return requestHeaders;
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
    const forwardedLocale = localeFromString(request.headers.get(LOCALE_ROUTE_HEADER));
    if (forwardedLocale) {
      return NextResponse.next({
        request: { headers: requestWithLocale(request, forwardedLocale) },
      });
    }
    if (!isLocaleRoutedPath(request.nextUrl.pathname)) return NextResponse.next();

    const response = NextResponse.next({
      request: { headers: requestWithLocale(request, "en") },
    });
    setLocaleCookie(response, "en");
    return response;
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
  setLocaleCookie(response, routeLocale);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
