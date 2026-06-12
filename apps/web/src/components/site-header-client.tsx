"use client";

import {
  Gamepad2Icon,
  LanguagesIcon,
  LayoutGridIcon,
  NewspaperIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrophyIcon,
  Tv2Icon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  copy,
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
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-8">
        <Link
          href={localizedPath("/", locale)}
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-9 gap-1.5 px-0 sm:size-auto sm:px-2.5"
                  aria-label={text.common.browse}
                />
              }
            >
              <LayoutGridIcon />
              <span className="hidden sm:inline">{text.common.browse}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href={localizedPath("/games", locale)} />}>
                  <Gamepad2Icon />
                  {text.common.games}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={localizedPath("/news", locale)} />}>
                  <NewspaperIcon />
                  {text.common.news}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={localizedPath("/media", locale)} />}>
                  <Tv2Icon />
                  {text.common.media}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={localizedPath("/tournaments", locale)} />}>
                  <TrophyIcon />
                  {text.common.tournaments}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={localizedPath("/predictions", locale)} />}>
                <TargetIcon />
                {text.common.predictions}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {hasSession ? (
            <Button
              render={<Link href={localizedPath("/admin", locale)} />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="size-9 gap-1.5 px-0 sm:size-auto sm:px-2.5"
              aria-label={text.common.admin}
            >
              <ShieldCheckIcon />
              <span className="hidden sm:inline">{text.common.admin}</span>
            </Button>
          ) : null}
          <Button
            render={<Link href={localizedPath("/me", locale)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            className="size-9 gap-1.5 px-0 sm:size-auto sm:px-2.5"
            aria-label={text.common.myProfile}
          >
            <UserRoundIcon />
            <span className="hidden sm:inline">{text.common.myProfile}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={switchLanguage}
            className="size-9 gap-1.5 px-0 sm:size-auto sm:px-2.5"
            aria-label={text.common.languageSwitch}
          >
            <LanguagesIcon />
            <span className="hidden sm:inline">{text.common.languageSwitch}</span>
          </Button>
          <ModeToggle label={text.common.themeToggle} />
        </nav>
      </div>
    </header>
  );
}
