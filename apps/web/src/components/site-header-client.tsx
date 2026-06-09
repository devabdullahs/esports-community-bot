"use client";

import { Gamepad2Icon, LanguagesIcon, TrophyIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  copy,
  directionForLocale,
  localizedPath,
  type Locale,
} from "@/lib/i18n";

export function SiteHeaderClient({
  hasSession,
  locale,
}: {
  hasSession: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const text = copy[locale];
  const nextLocale = locale === "ar" ? "en" : "ar";

  function switchLanguage() {
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
    router.refresh();
  }

  return (
    <header
      lang={locale}
      dir={directionForLocale(locale)}
      className="sticky top-0 z-40 w-full border-b bg-background/95 supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-8">
        <Link
          href={localizedPath("/", locale)}
          className="flex min-w-0 items-center gap-2.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground">
            <TrophyIcon />
          </span>
          <span className="hidden min-w-0 flex-col leading-none sm:flex">
            <span className="truncate text-sm font-semibold">
              {text.common.brand}
            </span>
            <span className="truncate text-[0.7rem] text-muted-foreground">
              {text.common.community}
            </span>
          </span>
        </Link>
        <nav className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Button
            render={<Link href={localizedPath("/games", locale)} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="size-8 px-0 sm:size-auto sm:px-2.5"
            aria-label={text.common.games}
          >
            <Gamepad2Icon className="sm:hidden" />
            <span className="hidden sm:inline">{text.common.games}</span>
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
            className="hidden sm:inline-flex"
            aria-label={text.common.myProfile}
          >
            <UserRoundIcon data-icon="inline-start" />
            {text.common.myProfile}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={switchLanguage}
            className="size-8 px-0 sm:size-auto sm:px-2.5"
            aria-label={text.common.languageSwitch}
          >
            <LanguagesIcon data-icon="inline-start" />
            <span className="hidden sm:inline">{text.common.languageSwitch}</span>
          </Button>
          <div className="hidden sm:block">
            <ModeToggle label={text.common.themeToggle} />
          </div>
        </nav>
      </div>
    </header>
  );
}
