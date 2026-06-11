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
import { localizeText } from "@/lib/community-content";
import { DEFAULT_SEASON, defaultPublicGuildId } from "@/lib/env";
import { listGamesCached } from "@/lib/games";
import { listLatestPublishedNewsPostsCached } from "@/lib/news";
import {
  copy,
  formatDateTime,
  localizedPath,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { safeUrlOrUndefined } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const locale = await getRequestLocale();
  const text = copy[locale];
  const defaultGuildId = defaultPublicGuildId();
  const leaderboardHref = defaultGuildId
    ? localizedPath(`/leaderboard/${defaultGuildId}/${DEFAULT_SEASON}`, locale)
    : null;
  const profileHref = localizedPath("/me", locale);
  const gamesHref = localizedPath("/games", locale);

  const games = await listGamesCached();
  const latestPosts = await listLatestPublishedNewsPostsCached(locale, 3);
  const gameTitleOf = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, locale) : slug;
  };

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 sm:px-8 lg:py-20">
        <Badge variant="outline">{text.home.eyebrow}</Badge>
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
          {leaderboardHref ? (
            <Button
              render={<Link href={leaderboardHref} />}
              nativeButton={false}
              size="lg"
              variant="outline"
            >
              <TrophyIcon data-icon="inline-start" />
              {text.home.openLeaderboard}
            </Button>
          ) : null}
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

      {/* Games the community follows */}
      {games.length ? (
        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold leading-tight">{text.home.gamesHeading}</h2>
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
                    className="h-full transition-[box-shadow] group-hover:shadow-md group-hover:ring-primary/40"
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
            <h2 className="text-2xl font-semibold leading-tight">{text.home.newsHeading}</h2>
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
                      className="h-full overflow-hidden transition-[box-shadow] group-hover:shadow-md group-hover:ring-primary/40"
                    >
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                        <img src={cover} alt="" className="aspect-video w-full object-cover" />
                      ) : null}
                      <CardHeader>
                        <Badge variant="secondary" className="mb-2 w-fit">
                          <NewspaperIcon data-icon="inline-start" />
                          {gameTitleOf(post.gameSlug)}
                        </Badge>
                        <CardTitle>{post.title}</CardTitle>
                        {post.summary ? (
                          <CardDescription className="article-copy line-clamp-2">
                            {post.summary}
                          </CardDescription>
                        ) : null}
                        {post.publishedAt ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(post.publishedAt, locale)}
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
