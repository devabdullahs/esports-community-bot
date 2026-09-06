"use client";

import {
  BellIcon,
  ChevronDownIcon,
  Gamepad2Icon,
  LanguagesIcon,
  LogOutIcon,
  MenuIcon,
  NewspaperIcon,
  RadioIcon,
  ShieldCheckIcon,
  TrophyIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DiscordIcon } from "@/components/discord-icon";
import {
  NotificationUnreadBadge,
  useUnreadNotifications,
} from "@/components/follows/notification-badge";
import { ModeToggle } from "@/components/mode-toggle";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { GlobalSearch } from "@/components/search/global-search";
import { signOut } from "@/lib/auth-client";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DISCORD_INVITE_URL } from "@/lib/community-links";
import { isActivePath } from "@/lib/nav";
import { trackProductEvent } from "@/lib/product-analytics";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  copy,
  localizedPath,
  stripLocalePrefix,
  type Locale,
} from "@/lib/i18n";

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
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => document.documentElement.style.setProperty("--site-header-height", `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, []);
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const text = copy[locale];
  const unreadNotifications = useUnreadNotifications(hasSession);
  const primary = [
    {
      href: "/live",
      label: locale === "ar" ? "المباريات" : "Matches",
      icon: RadioIcon,
    },
    { href: "/tournaments", label: text.common.tournaments, icon: TrophyIcon },
    { href: "/games", label: text.common.games, icon: Gamepad2Icon },
    { href: "/news", label: text.common.news, icon: NewspaperIcon },
  ];
  const community = [
    { href: "/co-streams", label: text.common.coStreams },
    { href: "/predictions", label: text.common.predictions },
    { href: "/leaderboard", label: text.common.publicLeaderboard },
    { href: "/teams", label: text.common.teams },
    { href: "/players", label: text.common.players },
    {
      href: "/mvp",
      label: locale === "ar" ? "أفضل لاعب اليوم" : "MVP of the day",
    },
    { href: "/compare", label: text.profiles.compare },
    { href: "/media", label: text.common.media },
  ];
  const ewc = [
    { href: "/tournaments/ewc", label: text.common.ewcTournaments },
    { href: "/news/ewc", label: text.common.ewcNews },
    { href: "/clubs", label: text.common.ewcClubs },
    { href: "/clubs/standings", label: text.common.ewcClubStandings },
  ];
  const active = (href: string) =>
    isActivePath(stripLocalePrefix(pathname), href);
  const streamBadge = (href: string) =>
    href === "/co-streams" && liveCoStreams > 0 ? (
      <span className="ec-live-count">
        <RadioIcon className="size-3" aria-hidden="true" />
        {liveCoStreams}
      </span>
    ) : null;

  function switchLanguage() {
    const nextLocale = locale === "ar" ? "en" : "ar";
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
    // Full navigation updates root lang/dir and preserves query/hash context.
    window.location.assign(
      localizedPath(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        nextLocale,
      ),
    );
  }
  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.push(localizedPath("/", locale));
      router.refresh();
    }
  }

  return (
    <header ref={headerRef} className="ec-site-header">
      <div className="ec-container ec-masthead">
        <Link
          href={localizedPath("/", locale)}
          className="ec-brand"
          aria-label={text.common.brand}
        >
          <span className="ec-brand-mark">
            <TrophyIcon aria-hidden="true" className="size-6" />
          </span>
          <span className="ec-brand-name">
            <strong>ESPORTS</strong>
            <span>{locale === "ar" ? "المجتمع" : "COMMUNITY"}</span>
          </span>
        </Link>
        <nav
          className="ec-primary-nav"
          aria-label={locale === "ar" ? "التنقل الرئيسي" : "Primary navigation"}
        >
          {primary.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={localizedPath(href, locale)}
              aria-current={active(href) ? "page" : undefined}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="ec-header-tools">
          <GlobalSearch locale={locale} />
          <Button
            variant="ghost"
            size="icon"
            onClick={switchLanguage}
            aria-label={text.common.languageSwitch}
          >
            <LanguagesIcon />
          </Button>
          <ModeToggle label={text.common.themeToggle} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="hidden lg:inline-flex"
                  aria-label={text.common.account}
                />
              }
            >
              <UserRoundIcon data-icon="inline-start" />
              {text.common.account}
              <NotificationUnreadBadge
                count={unreadNotifications}
                locale={locale}
              />
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={<Link href={localizedPath("/me", locale)} />}
                >
                  <UserRoundIcon />
                  {text.common.myProfile}
                </DropdownMenuItem>
                {hasSession ? (
                  <DropdownMenuItem
                    render={
                      <Link
                        href={localizedPath("/me?tab=notifications", locale)}
                      />
                    }
                  >
                    <BellIcon />
                    {text.follows.notificationsTitle}
                    <NotificationUnreadBadge
                      count={unreadNotifications}
                      locale={locale}
                    />
                  </DropdownMenuItem>
                ) : null}
                {isAdmin ? (
                  <DropdownMenuItem
                    render={<Link href={localizedPath("/admin", locale)} />}
                  >
                    <ShieldCheckIcon />
                    {text.common.admin}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  render={
                    <a
                      href={DISCORD_INVITE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackProductEvent("discord_join_click")}
                    />
                  }
                >
                  <DiscordIcon />
                  {text.common.discord}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {hasSession ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={handleSignOut}
                      disabled={signingOut}
                    >
                      <LogOutIcon />
                      {text.common.signOut}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={text.common.menu}
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent
              side={locale === "ar" ? "left" : "right"}
              className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto"
            >
              <SheetHeader>
                <SheetTitle>{text.common.brand}</SheetTitle>
                <SheetDescription>
                  {locale === "ar"
                    ? "المنافسات والمجتمع، في مكان واحد."
                    : "Competition and community, together."}
                </SheetDescription>
              </SheetHeader>
              <nav className="ec-mobile-menu" aria-label={text.common.menu}>
                {[
                  { label: text.common.competition, links: primary },
                  { label: text.common.community, links: community },
                  { label: text.common.ewc, links: ewc },
                ].map((group) => (
                  <div key={group.label}>
                    <h2>{group.label}</h2>
                    {group.links.map((link) => (
                      <Link
                        key={link.href}
                        href={localizedPath(link.href, locale)}
                        aria-current={active(link.href) ? "page" : undefined}
                        onClick={() => setMobileOpen(false)}
                        className="ec-mobile-link"
                      >
                        {link.label}
                        {streamBadge(link.href)}
                      </Link>
                    ))}
                  </div>
                ))}
                <div>
                  <h2>{text.common.account}</h2>
                  <Link
                    href={localizedPath("/me", locale)}
                    onClick={() => setMobileOpen(false)}
                    className="ec-mobile-link"
                  >
                    {text.common.myProfile}
                  </Link>
                  {hasSession ? (
                    <Link
                      href={localizedPath("/me?tab=notifications", locale)}
                      onClick={() => setMobileOpen(false)}
                      className="ec-mobile-link"
                    >
                      {text.follows.notificationsTitle}
                      <NotificationUnreadBadge
                        count={unreadNotifications}
                        locale={locale}
                      />
                    </Link>
                  ) : null}
                  {isAdmin ? (
                    <Link
                      href={localizedPath("/admin", locale)}
                      onClick={() => setMobileOpen(false)}
                      className="ec-mobile-link"
                    >
                      {text.common.admin}
                    </Link>
                  ) : null}
                  <a
                    href={DISCORD_INVITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ec-mobile-link"
                    onClick={() => {
                      trackProductEvent("discord_join_click");
                      setMobileOpen(false);
                    }}
                  >
                    <DiscordIcon className="size-4" />
                    {text.common.joinDiscord}
                  </a>
                  {hasSession ? (
                    <SignOutButton
                      label={text.common.signOut}
                      redirectTo={localizedPath("/", locale)}
                      className="w-full justify-start"
                    />
                  ) : null}
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <div className="ec-secondary-bar">
        <div className="ec-container ec-secondary-inner">
          <span className="ec-rail-label">
            {locale === "ar" ? "المجتمع" : "COMMUNITY"}
          </span>
          <nav aria-label={locale === "ar" ? "المجتمع" : "Community"}>
            {community.slice(0, 5).map((link) => (
              <Link
                key={link.href}
                href={localizedPath(link.href, locale)}
                aria-current={active(link.href) ? "page" : undefined}
              >
                {link.label}
                {streamBadge(link.href)}
              </Link>
            ))}
          <DropdownMenu>
            <DropdownMenuTrigger className="ec-more-trigger">
              {locale === "ar" ? "المزيد" : "More"}
              <ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                {community.slice(5).map((link) => (
                  <DropdownMenuItem
                    key={link.href}
                    render={<Link href={localizedPath(link.href, locale)} />}
                  >
                    {link.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="ec-ewc-trigger">
              {text.common.ewc}
              <ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {ewc.map((link) => (
                  <DropdownMenuItem
                    key={link.href}
                    render={<Link href={localizedPath(link.href, locale)} />}
                  >
                    {link.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </nav>
        </div>
      </div>
    </header>
  );
}
