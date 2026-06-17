import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_ROUTE_HEADER,
  isLocaleRoutedPath,
  localeFromPathname,
  localeFromString,
  localizedPath,
  stripLocalePrefix,
} from "@/lib/i18n";

export function proxy(request: NextRequest) {
  const legacyLocale = localeFromString(request.nextUrl.searchParams.get("lang"));
  if (legacyLocale) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("lang");
    url.pathname = localizedPath(url.pathname, legacyLocale);
    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE_NAME, legacyLocale, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
    return response;
  }

  const routeLocale = localeFromPathname(request.nextUrl.pathname);
  if (!routeLocale) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = stripLocalePrefix(url.pathname);

  if (!isLocaleRoutedPath(url.pathname)) {
    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE_NAME, routeLocale, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_ROUTE_HEADER, routeLocale);

  const response = NextResponse.rewrite(url, {
    request: { headers: requestHeaders },
  });
  response.cookies.set(LOCALE_COOKIE_NAME, routeLocale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
