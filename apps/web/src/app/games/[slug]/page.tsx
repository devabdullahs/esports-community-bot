import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RadioIcon, ShieldCheckIcon } from "lucide-react";
import { FollowButton } from "@/components/follows/follow-button";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { GameLogoMark } from "@/components/game-logo-mark";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/esports/section-heading";
import { MatchRow, ScheduleGroup } from "@/components/esports/match-row";
import { NewsStory } from "@/components/esports/news-story";
import { OfficialTournamentAttribution } from "@/components/tournaments/official-tournament-attribution";
import { localizeText } from "@/lib/community-content";
import { getViewerFollowState } from "@/lib/follows";
import { getGameCached } from "@/lib/games";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { listPublishedNewsPostsCached } from "@/lib/news";
import { getRequestLocale } from "@/lib/request-locale";
import { canManageGame, getAdminAccess } from "@/lib/admin";
import { buildPageMetadata } from "@/lib/metadata";
import {
  getTournamentMatchesCached,
  listTournamentSummariesCached,
} from "@/lib/tournaments";
import { buildLiveMatchCenter } from "@/lib/live-match-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gameDescription(
  title: string,
  description: string,
  locale: "en" | "ar",
) {
  return (
    description.trim() ||
    (locale === "ar"
      ? `تابع بطولات ${title} والمباريات المباشرة والقادمة والنتائج وأخبار المجتمع.`
      : `Follow ${title} esports tournaments, live and upcoming matches, results, and community news.`)
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [game, locale] = await Promise.all([
    getGameCached(slug),
    getRequestLocale(),
  ]);
  if (!game) return {};
  const title = localizeText(game.title, locale);
  return buildPageMetadata({
    title,
    description: gameDescription(
      title,
      localizeText(game.description, locale),
      locale,
    ),
    path: localizedPath(`/games/${slug}`, locale),
  });
}
export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = await getGameCached(slug);
  if (!game) notFound();
  const locale = await getRequestLocale();
  const text = copy[locale];
  const ar = locale === "ar";
  const [posts, allTournaments, access, follow] = await Promise.all([
    listPublishedNewsPostsCached(slug, locale),
    listTournamentSummariesCached(),
    getAdminAccess(),
    getViewerFollowState("game", slug),
  ]);
  const title = localizeText(game.title, locale);
  const tournaments = allTournaments
    .filter(
      (event) =>
        event.game === slug &&
        (event.hasStandings ||
          event.matchCounts.running ||
          event.matchCounts.scheduled ||
          event.matchCounts.finished),
    )
    .sort(
      (a, b) =>
        b.matchCounts.running - a.matchCounts.running ||
        (a.featuredMatch?.scheduled_at ?? Infinity) -
          (b.featuredMatch?.scheduled_at ?? Infinity),
    )
    .slice(0, 6);
  const matches = buildLiveMatchCenter(
    await Promise.all(
      tournaments.map((event) =>
        getTournamentMatchesCached(event.id, { limit: 5 }),
      ),
    ),
  );
  return (
    <main className="ec-container ec-public-page flex flex-col gap-6 py-7">
      <PageBreadcrumb
        items={[
          { label: text.common.home, href: localizedPath("/", locale) },
          { label: text.common.games, href: localizedPath("/games", locale) },
          { label: title },
        ]}
      />
      <header className="ec-page-heading ec-game-heading flex flex-wrap items-center gap-5">
        <GameLogoMark slug={slug} className="size-16" iconClassName="size-12" />
        <div className="min-w-0 flex-1">
          <p className="ec-kicker">{ar ? "ساحة المنافسة" : "GAME HUB"}</p>
          <h1>{title}</h1>
          <p>
            {gameDescription(
              title,
              localizeText(game.description, locale),
              locale,
            )}
          </p>
        </div>
        <FollowButton
          entityType="game"
          entityKey={slug}
          entityLabel={title}
          entityRef={`/games/${slug}`}
          signedIn={follow.signedIn}
          initialFollowing={follow.following}
          locale={locale}
          callbackPath={localizedPath(`/games/${slug}`, locale)}
        />
      </header>
      <nav
        className="ec-context-nav"
        aria-label={ar ? "أقسام اللعبة" : "Game sections"}
      >
        <a href="#game-matches">{ar ? "المباريات" : "Matches"}</a>
        <a href="#game-results">{ar ? "النتائج" : "Results"}</a>
        <a href="#game-tournaments">{text.common.tournaments}</a>
        <a href="#game-news">{text.common.news}</a>
      </nav>
      <div className="ec-desk-layout">
        <div className="ec-desk-main">
          <section id="game-matches">
            <SectionHeading title={text.tournaments.liveNow} />
            {matches.running.length ? (
              matches.running.map((item) => (
                <MatchRow key={item.id} item={item} locale={locale} />
              ))
            ) : (
              <div className="ec-empty">
                <p>{text.tournaments.noLive}</p>
              </div>
            )}
            <h2 className="mb-3 mt-6 text-lg font-semibold">
              {text.tournaments.upcoming}
            </h2>
            {matches.upcoming.length ? (
              <ScheduleGroup
                items={matches.upcoming.slice(0, 8)}
                locale={locale}
              />
            ) : (
              <div className="ec-empty">
                <p>{text.tournaments.noUpcoming}</p>
              </div>
            )}
          </section>
          <section id="game-results">
            <SectionHeading title={ar ? "آخر النتائج" : "Latest results"} />
            {matches.recentFinished.length ? (
              matches.recentFinished.map((item) => (
                <MatchRow key={item.id} item={item} locale={locale} />
              ))
            ) : (
              <div className="ec-empty">
                <p>
                  {ar ? "لم تُسجّل نتائج بعد." : "No results recorded yet."}
                </p>
              </div>
            )}
          </section>
          <section id="game-news">
            <SectionHeading title={text.game.postsTitle} />
            {posts.length ? (
              posts.map((post, index) => (
                <NewsStory
                  key={post.id}
                  post={post}
                  locale={locale}
                  label={title}
                  featured={index === 0}
                />
              ))
            ) : (
              <div className="ec-empty">
                <p>{text.game.postsEmpty}</p>
              </div>
            )}
          </section>
        </div>
        <aside className="ec-desk-aside">
          <section id="game-tournaments">
            <SectionHeading
              title={text.common.tournaments}
              href={localizedPath(`/tournaments?game=${slug}`, locale)}
              action={ar ? "عرض الكل" : "View all"}
            />
            {tournaments.length ? (
              tournaments.map((event) => (
                <Link
                  key={event.id}
                  href={localizedPath(`/tournaments/${event.id}`, locale)}
                  className="ec-event-row"
                >
                  <GameLogoMark
                    slug={slug}
                    className="size-8"
                    iconClassName="size-6"
                  />
                  <div>
                    {event.matchCounts.running ? (
                      <span className="ec-event-state">
                        <RadioIcon className="size-3" />
                        {text.tournaments.liveNow}
                      </span>
                    ) : null}
                    <h3 dir="auto">{event.name}</h3>
                    <p>
                      {formatNumber(event.matchCounts.scheduled, locale)}{" "}
                      {text.tournaments.upcoming} ·{" "}
                      {formatNumber(event.matchCounts.finished, locale)}{" "}
                      {text.tournaments.finished}
                      {event.hasStandings
                        ? ` · ${text.tournaments.standings}`
                        : ""}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="ec-empty">
                <p>{text.tournaments.empty}</p>
              </div>
            )}
          </section>
          <section>
            <SectionHeading title={ar ? "حول التغطية" : "About the coverage"} />
            <p className="mt-4 text-sm text-muted-foreground">
              {localizeText(game.owner, locale)}
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {game.focus.map((item) => (
                <li key={localizeText(item, locale)}>
                  {localizeText(item, locale)}
                </li>
              ))}
            </ul>
            {canManageGame(access, slug) ? (
              <Button
                render={<Link href={localizedPath("/admin", locale)} />}
                nativeButton={false}
                variant="outline"
                className="mt-4"
              >
                <ShieldCheckIcon data-icon="inline-start" />
                {text.game.admin}
              </Button>
            ) : null}
          </section>
        </aside>
      </div>
      <OfficialTournamentAttribution value={matches.attribution} />
    </main>
  );
}
