import "server-only";

import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE_NAME,
  localeFromAcceptLanguage,
  localeFromString,
  type Locale,
} from "@/lib/i18n";

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = localeFromString(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  if (cookieLocale) return cookieLocale;

  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get("accept-language"));
}
