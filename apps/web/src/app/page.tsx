import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  Gamepad2Icon,
  NewspaperIcon,
  TrophyIcon,
  UserRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { localizeText } from "@/lib/community-content";
import { listGamesCached } from "@/lib/games";
import { listLatestPublishedNewsPostsCached } from "@/lib/news";
import { listTournamentSummariesCached, type TournamentSummary } from "@/lib/tournaments";
import {
  copy,
  localizedPath,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { buildPageMetadata, siteDescription, siteName } from "@/lib/metadata";
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

  const games = await listGamesCached();
  const latestPosts = await listLatestPublishedNewsPostsCached(locale, 3);
  const gameTitleOf = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, locale) : slug;
  };

  const summaries = await listTournamentSummariesCached();
  const live = summaries.filter((t) => t.matchCounts.running > 0);
  const upcoming = summaries
    .filter((t) => t.matchCounts.running === 0 && t.matchCounts.scheduled > 0)
    .slice(0, 6);

  const tournamentCard = (t: TournamentSummary, isLive: boolean) => (
    <Link
      key={t.id}
      href={localizedPath(`/tournaments/${t.id}`, locale)}
      className="group block"
    >
      <Card
        size="sm"
        className="h-full ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40"
      >
        <CardHeader>
          <Badge
            variant={isLive ? "outline" : "secondary"}
            className={
              isLive
                ? "mb-2 w-fit border-primary/35 bg-primary/10 text-primary"
                : "mb-2 w-fit"
            }
          >
            {isLive ? (
              <>
                <span aria-hidden className="inline-block size-1.5 rounded-full bg-primary" />
                {text.home.liveBadge}
              </>
            ) : (
              <TrophyIcon data-icon="inline-start" />
            )}
            {isLive
              ? `${t.matchCounts.running} ${text.home.matchesLabel}`
              : `${t.matchCounts.scheduled} ${text.home.matchesLabel}`}
          </Badge>
          <CardTitle dir="auto">{t.name ?? gameTitleOf(t.game ?? "")}</CardTitle>
          <CardDescription>{gameTitleOf(t.game ?? "")}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 sm:px-8 lg:py-20">
        <Badge variant="outline" className="border-primary/35 bg-primary/10 text-primary">
          {text.home.eyebrow}
        </Badge>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-balance sm:text-5xl">
          {text.home.title}
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          {text.home.description}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button render={<Link href={gamesHref} />} nativeButton={false} size="lg">
            <Gamepad2Icon data-icon="inline-start" />
            {text.home.openGames}
            <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
          </Button>
          <Button
            render={<Link href={leaderboardHref} />}
            nativeButton={false}
            size="lg"
            variant="outline"
          >
            <TrophyIcon data-icon="inline-start" />
            {text.home.openLeaderboard}
          </Button>
          <Button
            render={<Link href={profileHref} />}
            nativeButton={false}
            size="lg"
            variant="outline"
          >
            <UserRoundIcon data-icon="inline-start" />
            {text.home.openProfile}
          </Button>
        </div>
      </section>

      {/* Live now / Upcoming tournaments */}
      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
          {live.length || upcoming.length ? (
            <>
              {live.length ? (
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="flex items-center gap-2.5 text-2xl font-semibold leading-tight">
                      <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
                      {text.home.liveHeading}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{text.home.liveSubtitle}</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {live.map((t) => tournamentCard(t, true))}
                  </div>
                </div>
              ) : null}
              {upcoming.length ? (
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="flex items-center gap-2.5 text-2xl font-semibold leading-tight">
                      <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
                      {text.home.upcomingHeading}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {text.home.upcomingSubtitle}
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {upcoming.map((t) => tournamentCard(t, false))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div>
              <h2 className="flex items-center gap-2.5 text-2xl font-semibold leading-tight">
                <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
                {text.home.liveHeading}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{text.home.liveEmpty}</p>
            </div>
          )}
        </div>
      </section>

      {/* Games the community follows */}
      {games.length ? (
        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2.5 text-2xl font-semibold leading-tight">
                  <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
                  {text.home.gamesHeading}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{text.home.gamesSubtitle}</p>
              </div>
              <Button
                render={<Link href={gamesHref} />}
                nativeButton={false}
                variant="ghost"
                size="sm"
                className="shrink-0"
              >
                {text.home.seeAll}
                <ArrowRightIcon data-icon="inline-end" className="rtl:rotate-180" />
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
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
                    <CardHeader>
                      <Badge variant="secondary" className="mb-2 w-fit">
                        <Gamepad2Icon data-icon="inline-start" />
                        {localizeText(game.status, locale)}
                      </Badge>
                      <CardTitle>{localizeText(game.title, locale)}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {localizeText(game.description, locale)}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Latest news */}
      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8">
          <div>
            <h2 className="flex items-center gap-2.5 text-2xl font-semibold leading-tight">
              <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-primary" />
              {text.home.newsHeading}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{text.home.newsSubtitle}</p>
          </div>
          {latestPosts.length ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {latestPosts.map((post) => {
                const cover = safeUrlOrUndefined(post.coverImageUrl);
                return (
                  <Link
                    key={post.id}
                    href={localizedPath(`/games/${post.gameSlug}/news/${post.id}`, locale)}
                    className="group block"
                  >
                    <Card
                      size="sm"
                      className="h-full overflow-hidden ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md group-hover:ring-primary/40"
                    >
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                        <img src={cover} alt="" className="aspect-video w-full object-cover" />
                      ) : null}
                      <CardHeader>
                        <Badge variant="secondary" className="mb-2 w-fit">
                          <NewspaperIcon data-icon="inline-start" />
                          {gameTitleOf(post.gameSlug ?? "")}
                        </Badge>
                        <CardTitle dir="auto">{post.title}</CardTitle>
                        {post.summary ? (
                          <CardDescription dir="auto" className="article-copy line-clamp-2">
                            {post.summary}
                          </CardDescription>
                        ) : null}
                        {post.publishedAt ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            <DateTime value={post.publishedAt} locale={locale} />
                          </p>
                        ) : null}
                      </CardHeader>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{text.home.newsEmpty}</p>
          )}
        </div>
      </section>
    </main>
  );
}
