import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarDaysIcon,
  ClockIcon,
  Gamepad2Icon,
  NewspaperIcon,
  RadioIcon,
  SparklesIcon,
  TrophyIcon,
  UserRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { GameLogoMark } from "@/components/game-logo-mark";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { LiveCoStreamsStrip } from "@/components/streams/live-co-streams-strip";
import { localizeText } from "@/lib/community-content";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { listLatestPublishedNewsPostsCached, type NewsPost } from "@/lib/news";
import { newsPublicPath } from "@/lib/news-url";
import { listTournamentSummariesCached, type TournamentSummary } from "@/lib/tournaments";
import {
  copy,
  formatNumber,
  formatMatchStatusCount,
  localizedPath,
  type Locale,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { buildPageMetadata, siteDescription, siteName } from "@/lib/metadata";
import { getLatestMvpResult } from "@/lib/mvp";
import { displayImageUrl } from "@/lib/logo-url";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return buildPageMetadata({
    title: siteName(locale),
    description: siteDescription(locale),
    path: localizedPath("/", locale),
    locale,
  });
}

export default async function Home() {
  const locale = await getRequestLocale();
  const text = copy[locale];
  // /leaderboard auto-resolves the guild and redirects, so the CTA is always shown.
  const leaderboardHref = localizedPath("/leaderboard", locale);
  const profileHref = localizedPath("/me", locale);
  const gamesHref = localizedPath("/games", locale);
  const tournamentsHref = localizedPath("/tournaments", locale);
  const newsHref = localizedPath("/news", locale);

  const [games, latestPosts, summaries, latestMvp] = await Promise.all([
    listGamesCached(),
    listLatestPublishedNewsPostsCached(locale, 4),
    listTournamentSummariesCached(),
    getLatestMvpResult(),
  ]);
  const gameTitleOf = (slug: string) => gameTitleForSlug(slug, games, locale);
  const featuredPost = latestPosts[0] ?? null;
  const secondaryPosts = latestPosts.slice(1);
  const featuredPostCover = featuredPost ? safeUrlOrUndefined(featuredPost.coverImageUrl) : null;
  const newsPostHref = (post: NewsPost) => {
    return newsPublicPath(post, locale);
  };
  const newsPostLabel = (post: NewsPost) => {
    if (post.gameSlug) return gameTitleOf(post.gameSlug);
    if (post.mediaSlug) return text.common.media;
    return text.common.news;
  };
  const newsPostLogoSlug = (post: NewsPost) => post.gameSlug ?? post.mediaSlug ?? "news";

  const live = summaries
    .filter((t) => t.matchCounts.running > 0)
    .sort(compareTournamentPreviewStart);
  const upcoming = summaries
    .filter((t) => t.matchCounts.running === 0 && t.matchCounts.scheduled > 0)
    .sort(compareTournamentPreviewStart)
    .slice(0, 6);
  const trackedGameCount = new Set(summaries.map((t) => t.game).filter(Boolean)).size || games.length;
  const totalLiveMatches = summaries.reduce((sum, t) => sum + t.matchCounts.running, 0);
  const totalUpcomingMatches = summaries.reduce((sum, t) => sum + t.matchCounts.scheduled, 0);

  return (
    <main className="flex-1">
      <section className="border-b px-4 py-8 sm:px-8 lg:py-14">
        <div className="relative mx-auto grid max-w-6xl gap-7 overflow-hidden rounded-2xl border bg-card/35 p-5 shadow-sm shadow-black/10 sm:rounded-3xl sm:p-8 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-center lg:gap-10">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
          />
          <div className="flex flex-col items-start gap-6">
            <Badge variant="outline" className="border-primary/35 bg-primary/10 text-primary">
              {text.home.eyebrow}
            </Badge>
            <div className="flex max-w-3xl flex-col gap-4">
              <h1 className="text-3xl font-semibold leading-tight text-balance sm:text-5xl">
                {text.home.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                {text.home.description}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
              <Button
                render={<Link href={gamesHref} />}
                nativeButton={false}
                size="lg"
                className="w-full sm:w-auto"
              >
                <Gamepad2Icon data-icon="inline-start" />
                {text.home.openGames}
                <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
              </Button>
              <Button
                render={<Link href={leaderboardHref} />}
                nativeButton={false}
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
              >
                <TrophyIcon data-icon="inline-start" />
                {text.home.openLeaderboard}
              </Button>
              <Button
                render={<Link href={profileHref} />}
                nativeButton={false}
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
              >
                <UserRoundIcon data-icon="inline-start" />
                {text.home.openProfile}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HomeStat
              icon={TrophyIcon}
              label={text.tournaments.trackedTournaments}
              value={summaries.length}
              locale={locale}
            />
            <HomeStat
              icon={Gamepad2Icon}
              label={text.tournaments.trackedGames}
              value={trackedGameCount}
              locale={locale}
            />
            <HomeStat
              icon={CalendarDaysIcon}
              label={text.tournaments.upcoming}
              value={totalUpcomingMatches}
              locale={locale}
            />
            <HomeStat
              icon={RadioIcon}
              label={text.tournaments.live}
              value={totalLiveMatches}
              locale={locale}
              live={totalLiveMatches > 0}
            />
          </div>
        </div>
      </section>

      <LiveCoStreamsStrip locale={locale} />

      {latestMvp ? (
        <section className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
                <ProfileAvatar
                  src={latestMvp.winner.imageUrl}
                  name={latestMvp.winner.displayName}
                  className="size-14 shrink-0 border border-primary/30"
                  focus="top"
                />
                <div className="min-w-0 flex-1">
                  <Badge variant="outline" className="mb-1 border-primary/30 text-primary">
                    <TrophyIcon data-icon="inline-start" />
                    {locale === "ar" ? "أفضل لاعب في اليوم" : "MVP of the day"}
                  </Badge>
                  <p className="truncate text-lg font-semibold" dir="auto">{latestMvp.winner.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground" dir="auto">
                    {[latestMvp.winner.teamName, latestMvp.winner.game].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button render={<Link href={localizedPath("/mvp", locale)} />} nativeButton={false} variant="outline">
                  {locale === "ar" ? "عرض التصويت" : "View vote"}
                  <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-8">
          {live.length || upcoming.length ? (
            <>
              {live.length ? (
                <div className="flex flex-col gap-6 rounded-3xl border bg-card/20 p-4 shadow-sm shadow-black/10 sm:p-5">
                  <SectionHeading
                    title={text.home.liveHeading}
                    description={text.home.liveSubtitle}
                    actionHref={tournamentsHref}
                    actionLabel={text.home.seeAll}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    {live.slice(0, 4).map((t) => (
                      <TournamentPreview
                        key={t.id}
                        tournament={t}
                        locale={locale}
                        gameTitleOf={gameTitleOf}
                        isLive
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {upcoming.length ? (
                <div className="flex flex-col gap-6 rounded-3xl border bg-card/20 p-4 shadow-sm shadow-black/10 sm:p-5">
                  <SectionHeading
                    title={text.home.upcomingHeading}
                    description={text.home.upcomingSubtitle}
                    actionHref={tournamentsHref}
                    actionLabel={text.home.seeAll}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    {upcoming.map((t) => (
                      <TournamentPreview
                        key={t.id}
                        tournament={t}
                        locale={locale}
                        gameTitleOf={gameTitleOf}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-3xl border bg-card/20 p-6 shadow-sm shadow-black/10">
              <h2 className="flex items-center gap-2.5 text-2xl font-semibold leading-tight">
                <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
                {text.home.liveHeading}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{text.home.liveEmpty}</p>
            </div>
          )}
        </div>
      </section>

      <PartnerPlacement kind="homepage" locale={locale} />

      {/* Games the community follows */}
      {games.length ? (
        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
            <SectionHeading
              title={text.home.gamesHeading}
              description={text.home.gamesSubtitle}
              actionHref={gamesHref}
              actionLabel={text.home.seeAll}
            />
            <div className="grid gap-4 rounded-3xl border bg-card/20 p-4 shadow-sm shadow-black/10 sm:grid-cols-2 sm:p-5 md:grid-cols-3">
              {games.slice(0, 6).map((game) => (
                <Link
                  key={game.slug}
                  href={localizedPath(`/games/${game.slug}`, locale)}
                  className="group block"
                >
                  <Card
                    size="sm"
                    className="h-full ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40"
                  >
                    <CardHeader className="flex-row items-start gap-4">
                      <GameLogoMark
                        slug={game.slug}
                        label={localizeText(game.title, locale)}
                        className="size-12 rounded-2xl"
                        iconClassName="size-7"
                      />
                      <div className="min-w-0 flex-1">
                        <Badge variant="secondary" className="mb-2 w-fit">
                          {localizeText(game.status, locale)}
                        </Badge>
                        <CardTitle>{localizeText(game.title, locale)}</CardTitle>
                      </div>
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border text-muted-foreground transition group-hover:border-primary/40 group-hover:text-primary">
                        <ArrowRightIcon data-icon className="size-4 rtl:rotate-180" />
                      </span>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="line-clamp-2">
                        {localizeText(game.description, locale)}
                      </CardDescription>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Latest news */}
      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 overflow-hidden px-4 py-8 sm:px-8 sm:py-10">
          <SectionHeading
            title={text.home.newsHeading}
            description={text.home.newsSubtitle}
            actionHref={newsHref}
            actionLabel={text.home.seeAll}
          />
          {featuredPost ? (
            <div className="grid min-w-0 gap-3 overflow-hidden rounded-2xl border bg-card/20 p-3 shadow-sm shadow-black/10 sm:gap-4 sm:rounded-3xl sm:p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
              <Link href={newsPostHref(featuredPost)} className="group block min-w-0">
                <Card className="h-full min-w-0 overflow-hidden ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:shadow-black/15 group-hover:ring-primary/40">
                  {featuredPostCover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                    <img
                      src={featuredPostCover}
                      alt=""
                      className="aspect-[16/10] w-full object-cover sm:aspect-[16/7]"
                    />
                  ) : (
                    <div className="flex aspect-[16/10] items-center justify-center bg-muted/35 sm:aspect-[16/7]">
                      <NewspaperIcon className="size-12 text-primary/70" aria-hidden="true" />
                    </div>
                  )}
                  <CardHeader className="gap-3 p-4 sm:gap-4 sm:p-6">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <Badge className="border-primary/35 bg-primary/10 text-primary">
                        <SparklesIcon data-icon="inline-start" />
                        {text.home.featuredNews}
                      </Badge>
                      <Badge variant="secondary">{newsPostLabel(featuredPost)}</Badge>
                      {featuredPost.ewc ? (
                        <Badge variant="outline" className="border-primary/35 text-primary">
                          {text.common.ewc}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2">
                      <CardTitle dir="auto" className="line-clamp-2 text-xl sm:text-3xl">
                        {featuredPost.title}
                      </CardTitle>
                      {featuredPost.summary ? (
                        <CardDescription
                          dir="auto"
                          className="article-copy line-clamp-2 text-sm leading-6 sm:line-clamp-3 sm:text-base sm:leading-7"
                        >
                          {featuredPost.summary}
                        </CardDescription>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground sm:text-sm">
                      {featuredPost.publishedAt ? (
                        <span className="inline-flex items-center gap-2">
                          <CalendarDaysIcon className="size-4" aria-hidden="true" />
                          <DateTime value={featuredPost.publishedAt} locale={locale} />
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        {text.home.readStory}
                        <ArrowUpRightIcon className="size-4" aria-hidden="true" />
                      </span>
                    </div>
                  </CardHeader>
                </Card>
              </Link>

              {secondaryPosts.length ? (
                <div className="min-w-0 rounded-2xl border bg-card/25 p-3 sm:rounded-3xl sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{text.home.newsHeading}</p>
                      <h3 className="font-semibold">{text.home.moreNews}</h3>
                    </div>
                    <Badge variant="outline">
                      {formatNumber(secondaryPosts.length, locale)}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {secondaryPosts.map((post) => (
                      <Link
                        key={post.id}
                        href={newsPostHref(post)}
                        className="group flex min-w-0 items-center gap-3 rounded-2xl border border-transparent p-2 transition hover:border-primary/30 hover:bg-muted/35"
                      >
                        <GameLogoMark
                          slug={newsPostLogoSlug(post)}
                          label={newsPostLabel(post)}
                          className="size-9 rounded-xl sm:size-10"
                          iconClassName="size-[1.125rem] sm:size-5"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            dir="auto"
                            className="line-clamp-2 text-sm font-medium leading-5 group-hover:text-primary"
                          >
                            {post.title}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {newsPostLabel(post)}
                            {post.publishedAt ? (
                              <>
                                <span aria-hidden>-</span>
                                <DateTime value={post.publishedAt} locale={locale} />
                              </>
                            ) : null}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{text.home.newsEmpty}</p>
          )}
        </div>
      </section>
    </main>
  );
}

type FeaturedMatch = NonNullable<TournamentSummary["featuredMatch"]>;

function HomeStat({
  icon: Icon,
  label,
  value,
  locale,
  live = false,
}: {
  icon: typeof TrophyIcon;
  label: string;
  value: number;
  locale: Locale;
  live?: boolean;
}) {
  return (
    <Card size="sm" className="bg-background/40 shadow-none">
      <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border bg-muted text-primary sm:size-10 sm:rounded-2xl">
          <Icon data-icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-semibold leading-none sm:text-2xl">{formatNumber(value, locale)}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
        </div>
        {live ? (
          <span aria-hidden className="ms-auto size-2 rounded-full bg-destructive" />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2.5 text-balance text-xl font-semibold leading-tight sm:text-2xl">
          <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Button
        render={<Link href={actionHref} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="w-fit shrink-0"
      >
        {actionLabel}
        <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
      </Button>
    </div>
  );
}

function TournamentPreview({
  tournament,
  locale,
  gameTitleOf,
  isLive = false,
}: {
  tournament: TournamentSummary;
  locale: Locale;
  gameTitleOf: (slug: string) => string;
  isLive?: boolean;
}) {
  const text = copy[locale];
  const gameTitle = gameTitleOf(tournament.game ?? "");
  const featured = tournament.featuredMatch;

  return (
    <Link
      href={localizedPath(`/tournaments/${tournament.id}`, locale)}
      className="group block"
    >
      <Card
        size="sm"
        className="h-full ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40"
      >
        <CardHeader className="flex-row items-start gap-4">
          <GameLogoMark
            slug={tournament.game}
            label={gameTitle}
            className="size-12 rounded-2xl"
            iconClassName="size-7"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge
                variant={isLive ? "outline" : "secondary"}
                className={
                  isLive ? "border-primary/35 bg-primary/10 text-primary" : undefined
                }
              >
                {isLive ? (
                  <span aria-hidden className="inline-block size-1.5 rounded-full bg-primary" />
                ) : (
                  <CalendarDaysIcon data-icon="inline-start" />
                )}
                {formatMatchStatusCount(
                  isLive ? tournament.matchCounts.running : tournament.matchCounts.scheduled,
                  isLive ? "live" : "upcoming",
                  locale,
                )}
              </Badge>
              <Badge variant="secondary">{gameTitle}</Badge>
            </div>
            <CardTitle dir="auto" className="line-clamp-2">
              {tournament.name ?? gameTitle}
            </CardTitle>
          </div>
        </CardHeader>

        {featured ? (
          <CardContent>
            <MatchPreview match={featured} locale={locale} />
          </CardContent>
        ) : (
          <CardContent>
            <p className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {text.tournaments.noMatches}
            </p>
          </CardContent>
        )}
      </Card>
    </Link>
  );
}

function MatchPreview({ match, locale }: { match: FeaturedMatch; locale: Locale }) {
  const text = copy[locale];
  const hasScore = match.score_a != null && match.score_b != null;
  const score = hasScore
    ? `${formatNumber(match.score_a ?? 0, locale)} - ${formatNumber(match.score_b ?? 0, locale)}`
    : text.tournaments.vs;
  const matchLabel =
    match.status === "running" ? text.tournaments.liveNow : text.tournaments.nextMatch;

  return (
    <div className="rounded-2xl border bg-muted/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {match.status === "running" ? (
            <RadioIcon data-icon className="size-3.5 text-destructive" />
          ) : (
            <ClockIcon data-icon className="size-3.5 text-primary" />
          )}
          {matchLabel}
        </span>
        <span className="shrink-0">
          {match.scheduled_at ? (
            <DateTime value={match.scheduled_at * 1000} locale={locale} />
          ) : (
            text.tournaments.timeTbd
          )}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <TeamPill name={match.team_a} logo={match.logo_a} fallback={text.tournaments.tbd} />
        <span className="text-center text-sm font-semibold text-primary">{score}</span>
        <TeamPill name={match.team_b} logo={match.logo_b} fallback={text.tournaments.tbd} align="end" />
      </div>
    </div>
  );
}

function TeamPill({
  name,
  logo,
  fallback,
  align = "start",
}: {
  name: string | null;
  logo: string | null;
  fallback: string;
  align?: "start" | "end";
}) {
  const label = name || fallback;
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className={
        align === "end"
          ? "flex min-w-0 items-center justify-end gap-2"
          : "flex min-w-0 items-center gap-2"
      }
    >
      {align === "start" ? <TeamPillLogo name={label} logo={logo} initials={initials} /> : null}
      <span className="truncate text-sm font-semibold" dir="auto">
        {label}
      </span>
      {align === "end" ? <TeamPillLogo name={label} logo={logo} initials={initials} /> : null}
    </span>
  );
}

function TeamPillLogo({
  name,
  logo,
  initials,
}: {
  name: string;
  logo: string | null;
  initials: string;
}) {
  const safe = safeUrlOrUndefined(logo);
  if (safe) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- proxy/cached external crests, no sizing benefit from next/image here
      <img
        src={displayImageUrl(safe)}
        alt=""
        loading="lazy"
        className="size-8 shrink-0 rounded-xl bg-muted object-contain p-1"
      />
    );
  }

  return (
    <span
      title={name}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-[0.65rem] font-semibold text-muted-foreground"
    >
      {initials || "?"}
    </span>
  );
}

function compareTournamentPreviewStart(a: TournamentSummary, b: TournamentSummary): number {
  const startA = a.featuredMatch?.scheduled_at ?? Number.MAX_SAFE_INTEGER;
  const startB = b.featuredMatch?.scheduled_at ?? Number.MAX_SAFE_INTEGER;
  return (
    startA - startB ||
    b.matchCounts.running - a.matchCounts.running ||
    b.matchCounts.scheduled - a.matchCounts.scheduled ||
    (a.name ?? "").localeCompare(b.name ?? "")
  );
}
