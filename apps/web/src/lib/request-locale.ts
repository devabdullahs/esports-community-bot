import "server-only";

import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE_NAME,
  LOCALE_ROUTE_HEADER,
  localeFromAcceptLanguage,
  localeFromString,
  type Locale,
} from "@/lib/i18n";

export async function getRequestLocale(): Promise<Locale> {
  const headerStore = await headers();
  const routeLocale = localeFromString(headerStore.get(LOCALE_ROUTE_HEADER));
  if (routeLocale) return routeLocale;

  const cookieStore = await cookies();
  const cookieLocale = localeFromString(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  if (cookieLocale) return cookieLocale;

  return localeFromAcceptLanguage(headerStore.get("accept-language"));
}
