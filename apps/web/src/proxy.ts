import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  localeFromString,
} from "@/lib/i18n";

export function proxy(request: NextRequest) {
  const legacyLocale = localeFromString(request.nextUrl.searchParams.get("lang"));
  if (!legacyLocale) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.searchParams.delete("lang");
  const response = NextResponse.redirect(url);
  response.cookies.set(LOCALE_COOKIE_NAME, legacyLocale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
