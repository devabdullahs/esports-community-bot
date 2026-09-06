import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { GameLogoMark } from "@/components/game-logo-mark";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { NewsStory } from "@/components/esports/news-story";
import { SectionHeading } from "@/components/esports/section-heading";
import { localizeText } from "@/lib/community-content";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { listHomepageNewsPostsCached } from "@/lib/news";
import { listTournamentSummariesCached } from "@/lib/tournaments";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/metadata";
import { getRequestLocale } from "@/lib/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return buildPageMetadata({
    title: copy[locale].games.title,
    description: copy[locale].games.description,
    path: localizedPath("/games", locale),
    locale,
  });
}
export default async function GamesPage() {
  const locale = await getRequestLocale();
  const text = copy[locale];
  const [games, tournaments, posts] = await Promise.all([
    listGamesCached(),
    listTournamentSummariesCached(),
    listHomepageNewsPostsCached(locale, 3),
  ]);
  return (
    <main className="ec-container ec-public-page flex flex-col gap-6 py-7">
      <PageBreadcrumb
        items={[
          { label: text.common.home, href: localizedPath("/", locale) },
          { label: text.common.games },
        ]}
      />
      <header className="ec-page-heading">
        <p className="ec-kicker">
          {locale === "ar" ? "اختر ساحة المنافسة" : "CHOOSE YOUR ARENA"}
        </p>
        <h1>{text.common.games}</h1>
        <p>
          {locale === "ar"
            ? "البطولات والمباريات والنتائج والأخبار. كل ما يخص لعبتك في مكان واحد."
            : "Tournaments, matches, results, and stories. Everything for the esport you follow."}
        </p>
      </header>
      <section
        className="ec-game-directory"
        id="games-directory"
        aria-label={text.common.games}
      >
        {games.map((game) => {
          const events = tournaments.filter(
            (event) => event.game === game.slug,
          );
          const live = events.reduce(
            (sum, event) => sum + event.matchCounts.running,
            0,
          );
          return (
            <article key={game.slug} className="ec-game-directory-entry">
              <Link href={localizedPath(`/games/${game.slug}`, locale)}>
                <GameLogoMark
                  slug={game.slug}
                  className="size-14"
                  iconClassName="size-10"
                />
                <div>
                  <h2>{localizeText(game.title, locale)}</h2>
                  <p>{localizeText(game.status, locale)}</p>
                </div>
                <ArrowRightIcon className="ms-auto size-4 shrink-0 text-primary rtl:rotate-180" />
              </Link>
              <p>{localizeText(game.description, locale)}</p>
              <div className="ec-directory-stats">
                <span>
                  <strong>{formatNumber(events.length, locale)}</strong>{" "}
                  {text.common.tournaments}
                </span>
                {live ? (
                  <span className="text-live">
                    {formatNumber(live, locale)} {text.tournaments.liveNow}
                  </span>
                ) : null}
                <span>
                  {game.focus
                    .map((item) => localizeText(item, locale))
                    .join(" · ")}
                </span>
              </div>
            </article>
          );
        })}
      </section>
      {posts.length ? (
        <section>
          <SectionHeading
            title={text.common.news}
            href={localizedPath("/news", locale)}
            action={locale === "ar" ? "غرفة الأخبار" : "Newsroom"}
          />
          <div className="grid gap-6 md:grid-cols-3">
            {posts.map((post) => (
              <NewsStory
                key={post.id}
                post={post}
                locale={locale}
                label={gameTitleForSlug(post.gameSlug, games, locale)}
                featured
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
