"use client";

import {
  ChevronDownIcon,
  CrownIcon,
  Gamepad2Icon,
  LanguagesIcon,
  LogOutIcon,
  type LucideIcon,
  MedalIcon,
  MenuIcon,
  NewspaperIcon,
  RadioIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrophyIcon,
  Tv2Icon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { DiscordIcon } from "@/components/discord-icon";
import { ModeToggle } from "@/components/mode-toggle";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { DISCORD_INVITE_URL } from "@/lib/community-links";
import { isActivePath } from "@/lib/nav";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  copy,
  localizedPath,
  type Locale,
} from "@/lib/i18n";

type Destination = { href: string; label: string; icon: LucideIcon };

function MobileNavLink({
  destination,
  locale,
  active,
  badge = null,
}: {
  destination: Destination;
  locale: Locale;
  active: boolean;
  badge?: React.ReactNode;
}) {
  const { href, label, icon: Icon } = destination;

  return (
    <SheetClose
      render={
        <Link
          href={localizedPath(href, locale)}
          aria-current={active ? "page" : undefined}
        />
      }
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
      {badge}
    </SheetClose>
  );
}

export function SiteHeaderClient({
  hasSession,
  isAdmin,
  locale,
  liveCoStreams = 0,
}: {
  hasSession: boolean;
  isAdmin: boolean;
  locale: Locale;
  liveCoStreams?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const text = copy[locale];
  const nextLocale = locale === "ar" ? "en" : "ar";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.push(localizedPath("/", locale));
      router.refresh();
    }
  }

  // General destinations stay as top-level links; the EWC-specific pages (news,
  // tournaments, predictions, leaderboard) group under one "EWC" menu.
  const primary: Destination[] = [
    { href: "/games", label: text.common.games, icon: Gamepad2Icon },
    { href: "/news", label: text.common.news, icon: NewspaperIcon },
    { href: "/media", label: text.common.media, icon: Tv2Icon },
    { href: "/tournaments", label: text.common.tournaments, icon: TrophyIcon },
    { href: "/teams", label: text.common.teams, icon: UsersIcon },
    // Co-streams is a top-level destination (it spans every tracked event, not
    // just EWC) and carries a live indicator when any co-streamer is on air.
    { href: "/co-streams", label: text.common.coStreams, icon: RadioIcon },
  ];
  const ewcLinks: Destination[] = [
    { href: "/news/ewc", label: text.common.ewcNews, icon: NewspaperIcon },
    { href: "/tournaments/ewc", label: text.common.ewcTournaments, icon: TrophyIcon },
    { href: "/clubs", label: text.common.ewcClubs, icon: UsersIcon },
    { href: "/predictions", label: text.common.predictions, icon: TargetIcon },
    { href: "/leaderboard", label: text.common.publicLeaderboard, icon: CrownIcon },
  ];
  const liveBadge = (href: string) =>
    href === "/co-streams" && liveCoStreams > 0 ? (
      <span className="ms-0.5 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[0.65rem] font-semibold leading-none text-red-500">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
        </span>
        {liveCoStreams}
      </span>
    ) : null;
  const ewcActive = ewcLinks.some((d) =>
    isActivePath(pathname, localizedPath(d.href, locale)),
  );
  // Top-level "News"/"Tournaments" shouldn't light up while on their EWC sub-lists.
  const linkActive = (href: string) => {
    const full = localizedPath(href, locale);
    if (href === "/news" || href === "/tournaments") {
      return (
        isActivePath(pathname, full) &&
        !isActivePath(pathname, localizedPath(`${href}/ewc`, locale))
      );
    }
    return isActivePath(pathname, full);
  };

  function switchLanguage() {
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
    const currentPath =
      `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
    router.push(localizedPath(currentPath, nextLocale));
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

        {/* Desktop (md+): general links + an EWC dropdown grouping the EWC pages. */}
        <NavigationMenu className="ms-2 hidden md:flex">
          <NavigationMenuList className="gap-0.5">
            {primary.map(({ href, label, icon: Icon }) => {
              const active = linkActive(href);
              return (
                <NavigationMenuItem key={href}>
                  <NavigationMenuLink
                    data-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                    render={<Link href={localizedPath(href, locale)} />}
                  >
                    <Icon />
                    {label}
                    {liveBadge(href)}
                  </NavigationMenuLink>
                </NavigationMenuItem>
              );
            })}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={`gap-1.5 ${ewcActive ? "bg-muted/50" : ""}`}
              >
                <MedalIcon className="size-4" />
                {text.common.ewc}
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid w-56 gap-0.5">
                  {ewcLinks.map(({ href, label, icon: Icon }) => {
                    const active = linkActive(href);
                    return (
                      <li key={href}>
                        <NavigationMenuLink
                          data-active={active || undefined}
                          aria-current={active ? "page" : undefined}
                          render={<Link href={localizedPath(href, locale)} />}
                        >
                          <Icon />
                          {label}
                        </NavigationMenuLink>
                      </li>
                    );
                  })}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <nav className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Desktop account menu: Discord, Admin, profile, and sign out under one trigger. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden gap-1.5 px-2.5 md:inline-flex"
                  aria-label={text.common.account}
                />
              }
            >
              <UserRoundIcon />
              <span>{text.common.account}</span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                render={<Link href={localizedPath("/me", locale)} />}
                data-active={isActivePath(pathname, localizedPath("/me", locale)) || undefined}
              >
                <UserRoundIcon />
                {text.common.myProfile}
              </DropdownMenuItem>
              {isAdmin ? (
                <DropdownMenuItem
                  render={<Link href={localizedPath("/admin", locale)} />}
                  data-active={isActivePath(pathname, localizedPath("/admin", locale)) || undefined}
                >
                  <ShieldCheckIcon />
                  {text.common.admin}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                render={
                  <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" />
                }
              >
                <DiscordIcon />
                {text.common.discord}
              </DropdownMenuItem>
              {hasSession ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={handleSignOut}
                    disabled={signingOut}
                  >
                    <LogOutIcon />
                    {text.common.signOut}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
            <SheetContent
              side={sheetSide}
              className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto"
            >
              <SheetHeader className="border-b">
                <SheetTitle>{text.common.brand}</SheetTitle>
                <SheetDescription>{text.footer.note}</SheetDescription>
              </SheetHeader>
              <Button
                render={
                  <a
                    href={DISCORD_INVITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileOpen(false)}
                  />
                }
                nativeButton={false}
                variant="outline"
                className="m-3 mb-2 justify-start"
                aria-label={text.common.joinDiscord}
              >
                <DiscordIcon data-icon="inline-start" />
                {text.common.joinDiscord}
              </Button>
              <nav className="flex flex-col gap-1 px-3 pb-3">
                <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {text.common.browse}
                </p>
                {primary.map((destination) => (
                  <MobileNavLink
                    key={destination.href}
                    destination={destination}
                    locale={locale}
                    active={linkActive(destination.href)}
                    badge={liveBadge(destination.href)}
                  />
                ))}
                <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {text.common.ewc}
                </p>
                {ewcLinks.map((destination) => (
                  <MobileNavLink
                    key={destination.href}
                    destination={destination}
                    locale={locale}
                    active={linkActive(destination.href)}
                  />
                ))}
                <Separator className="my-2" />
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {text.common.account}
                </p>
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
                    <span className="min-w-0 truncate">{text.common.admin}</span>
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
                  <span className="min-w-0 truncate">{text.common.myProfile}</span>
                </SheetClose>
                {hasSession ? (
                  <SignOutButton
                    label={text.common.signOut}
                    redirectTo={localizedPath("/", locale)}
                    className="mt-1 w-full justify-start gap-3 px-3"
                  />
                ) : null}
              </nav>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </header>
  );
}
