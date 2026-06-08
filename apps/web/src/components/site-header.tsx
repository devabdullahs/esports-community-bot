"use client";

import { LanguagesIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  copy,
  directionForLocale,
  localeFromSearchParams,
  localizedHref,
  localizedPath,
} from "@/lib/i18n";

export function SiteHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = localeFromSearchParams(searchParams);
  const text = copy[locale];
  const nextLocale = locale === "ar" ? "en" : "ar";

  return (
    <header
      lang={locale}
      dir={directionForLocale(locale)}
      className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-6">
        <Link href={localizedPath("/", locale)} className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <TrophyIcon />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-sm font-semibold tracking-normal">{text.common.brand}</span>
            <span className="truncate text-[0.7rem] text-muted-foreground">{text.common.community}</span>
          </span>
        </Link>
        <nav className="ms-auto flex shrink-0 items-center gap-1">
          <Button
            render={<Link href={localizedPath("/me", locale)} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            {text.common.myProfile}
          </Button>
          <Button
            render={<Link href={localizedHref(pathname, searchParams, nextLocale)} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            <LanguagesIcon data-icon="inline-start" />
            {text.common.languageSwitch}
          </Button>
          <ModeToggle label={text.common.themeToggle} />
        </nav>
      </div>
    </header>
  );
}
