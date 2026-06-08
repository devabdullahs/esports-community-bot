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

export function SiteHeaderClient({ hasSession }: { hasSession: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = localeFromSearchParams(searchParams);
  const text = copy[locale];
  const nextLocale = locale === "ar" ? "en" : "ar";

  return (
    <header
      lang={locale}
      dir={directionForLocale(locale)}
      className="sticky top-0 z-40 w-full border-b bg-background/95 supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-5 sm:px-8">
        <Link
          href={localizedPath("/", locale)}
          className="flex min-w-0 items-center gap-2.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
            <TrophyIcon />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-sm font-semibold">
              {text.common.brand}
            </span>
            <span className="truncate text-[0.7rem] text-muted-foreground">
              {text.common.community}
            </span>
          </span>
        </Link>
        <nav className="ms-auto flex shrink-0 items-center gap-2">
          <Button
            render={<Link href={localizedPath("/games", locale)} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            {text.common.games}
          </Button>
          {hasSession ? (
            <Button
              render={<Link href={localizedPath("/admin", locale)} />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              {text.common.admin}
            </Button>
          ) : null}
          <Button
            render={<Link href={localizedPath("/me", locale)} />}
            nativeButton={false}
            variant="outline"
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
