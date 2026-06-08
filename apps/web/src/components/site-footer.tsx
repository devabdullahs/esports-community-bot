"use client";

import { useSearchParams } from "next/navigation";
import {
  copy,
  directionForLocale,
  localeFromSearchParams,
} from "@/lib/i18n";

export function SiteFooter() {
  const searchParams = useSearchParams();
  const locale = localeFromSearchParams(searchParams);
  const text = copy[locale].footer;

  return (
    <footer
      lang={locale}
      dir={directionForLocale(locale)}
      className="border-t"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-8">
        <p>{text.brand}</p>
        <p>{text.note}</p>
      </div>
    </footer>
  );
}
