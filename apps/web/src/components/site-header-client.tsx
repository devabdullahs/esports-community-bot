"use client";

import {
  Gamepad2Icon,
  LanguagesIcon,
  type LucideIcon,
  MenuIcon,
  NewspaperIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrophyIcon,
  Tv2Icon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isActivePath } from "@/lib/nav";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  copy,
  localizedPath,
  type Locale,
} from "@/lib/i18n";

type Destination = { href: string; label: string; icon: LucideIcon };

export function SiteHeaderClient({
  isAdmin,
  locale,
}: {
  // hasSession is provided by the server wrapper for completeness, but the
  // header only ever needs the resolved admin gate (isAdmin).
  hasSession: boolean;
  isAdmin: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const text = copy[locale];
  const nextLocale = locale === "ar" ? "en" : "ar";

  // Primary destinations, shown as visible links on desktop and listed in the
  // mobile sheet. Predictions stays in the same group (no separate dropdown).
  const destinations: Destination[] = [
    { href: "/games", label: text.common.games, icon: Gamepad2Icon },
    { href: "/news", label: text.common.news, icon: NewspaperIcon },
    { href: "/media", label: text.common.media, icon: Tv2Icon },
    { href: "/tournaments", label: text.common.tournaments, icon: TrophyIcon },
    { href: "/predictions", label: text.common.predictions, icon: TargetIcon },
  ];

  function switchLanguage() {
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
    router.refresh();
  }

  // In RTL the inline-end edge is the physical left, so flip the sheet side so
  // it always slides in from the same edge the hamburger sits on.
  const sheetSide = locale === "ar" ? "left" : "right";

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

        {/* Desktop (md+): primary destinations as visible top-level links. */}
        <NavigationMenu className="ms-2 hidden md:flex">
          <NavigationMenuList className="gap-0.5">
            {destinations.map(({ href, label, icon: Icon }) => {
              const active = isActivePath(pathname, localizedPath(href, locale));
              return (
                <NavigationMenuItem key={href}>
                  <NavigationMenuLink
                    data-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                    render={<Link href={localizedPath(href, locale)} />}
                  >
                    <Icon />
                    {label}
                  </NavigationMenuLink>
                </NavigationMenuItem>
              );
            })}
          </NavigationMenuList>
        </NavigationMenu>

        <nav className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Desktop-only right cluster links. */}
          {isAdmin ? (
            <Button
              render={<Link href={localizedPath("/admin", locale)} />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              data-active={isActivePath(pathname, localizedPath("/admin", locale)) || undefined}
              aria-current={isActivePath(pathname, localizedPath("/admin", locale)) ? "page" : undefined}
              className="hidden gap-1.5 px-2.5 aria-[current=page]:bg-muted md:inline-flex"
              aria-label={text.common.admin}
            >
              <ShieldCheckIcon />
              <span>{text.common.admin}</span>
            </Button>
          ) : null}
          <Button
            render={<Link href={localizedPath("/me", locale)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            data-active={isActivePath(pathname, localizedPath("/me", locale)) || undefined}
            aria-current={isActivePath(pathname, localizedPath("/me", locale)) ? "page" : undefined}
            className="hidden gap-1.5 px-2.5 md:inline-flex"
            aria-label={text.common.myProfile}
          >
            <UserRoundIcon />
            <span>{text.common.myProfile}</span>
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

          {/* Mobile (<md): hamburger opens a sheet with every destination. */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-9 px-0 md:hidden"
                  aria-label={text.common.menu}
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side={sheetSide} className="w-72 gap-0">
              <SheetHeader className="border-b">
                <SheetTitle>{text.common.brand}</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 p-3">
                {destinations.map(({ href, label, icon: Icon }) => {
                  const active = isActivePath(pathname, localizedPath(href, locale));
                  return (
                    <SheetClose
                      key={href}
                      render={
                        <Link
                          href={localizedPath(href, locale)}
                          aria-current={active ? "page" : undefined}
                        />
                      }
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      {label}
                    </SheetClose>
                  );
                })}
                <div className="my-1 border-t" />
                {isAdmin ? (
                  <SheetClose
                    render={
                      <Link
                        href={localizedPath("/admin", locale)}
                        aria-current={
                          isActivePath(pathname, localizedPath("/admin", locale))
                            ? "page"
                            : undefined
                        }
                      />
                    }
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                  >
                    <ShieldCheckIcon className="size-4 text-muted-foreground" />
                    {text.common.admin}
                  </SheetClose>
                ) : null}
                <SheetClose
                  render={
                    <Link
                      href={localizedPath("/me", locale)}
                      aria-current={
                        isActivePath(pathname, localizedPath("/me", locale))
                          ? "page"
                          : undefined
                      }
                    />
                  }
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                >
                  <UserRoundIcon className="size-4 text-muted-foreground" />
                  {text.common.myProfile}
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </header>
  );
}
