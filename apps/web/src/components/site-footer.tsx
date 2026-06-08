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
      className="border-t border-border/60"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 py-5 text-xs text-muted-foreground sm:flex-row">
        <p>{text.brand}</p>
        <p>{text.note}</p>
      </div>
    </footer>
  );
}
