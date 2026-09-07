import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  RadioIcon,
  TrophyIcon,
} from "lucide-react";
import { DailyShortcuts } from "@/components/esports/daily-shortcuts";
import { GameLogoMark } from "@/components/game-logo-mark";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { PartnerPlacement } from "@/components/partners/partner-placement";
import { LiveCoStreamsStrip } from "@/components/streams/live-co-streams-strip";
import { SectionHeading } from "@/components/esports/section-heading";
import { MatchRow, ScheduleGroup } from "@/components/esports/match-row";
import { NewsStory } from "@/components/esports/news-story";
import { OfficialTournamentAttribution } from "@/components/tournaments/official-tournament-attribution";
import { localizeText } from "@/lib/community-content";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { listHomepageNewsPostsCached } from "@/lib/news";
import { listTournamentSummariesCached } from "@/lib/tournaments";
import { getLiveMatchCenter } from "@/lib/live-match-center";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { buildPageMetadata, siteDescription, siteName } from "@/lib/metadata";
import { getLatestMvpResult } from "@/lib/mvp";

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
  const [games, posts, summaries, matches, mvp] = await Promise.all([
    listGamesCached(),
    listHomepageNewsPostsCached(locale, 4),
    listTournamentSummariesCached(),
    getLiveMatchCenter(),
    getLatestMvpResult(),
  ]);
  const href = (path: string) => localizedPath(path, locale);
  const ar = locale === "ar";
  const events = [...summaries]
    .sort(
      (a, b) =>
        b.matchCounts.running - a.matchCounts.running ||
        b.matchCounts.scheduled - a.matchCounts.scheduled,
    )
    .slice(0, 5);
  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Riyadh",
  }).format(new Date());
  return (
    <main className="ec-container ec-home ec-public-page">
      <header className="ec-desk-heading">
        <div>
          <p className="ec-kicker">
            {ar ? "من قلب المنافسة" : "THE COMMUNITY. THE COMPETITION."}
          </p>
          <h1>{ar ? "كل ما يهمك في المنافسة" : "Your daily esports desk"}</h1>
        </div>
        <p className="ec-desk-date">
          {today}
          <br />
          {ar ? "بتوقيت الرياض" : "Riyadh time"} · UTC+3
        </p>
      </header>
      <DailyShortcuts locale={locale} />
      <div className="ec-desk-layout">
        <div className="ec-desk-main">
          <section aria-labelledby="home-live">
            <SectionHeading
              id="home-live"
              title={text.tournaments.liveNow}
              href={href("/live")}
              action={ar ? "مركز المباريات" : "Match center"}
            >
              <span>{formatNumber(matches.running.length, locale)}</span>
            </SectionHeading>
            {matches.running.length ? (
              matches.running
                .slice(0, 4)
                .map((item) => (
                  <MatchRow key={item.id} item={item} locale={locale} />
                ))
            ) : (
              <div className="ec-empty">
                <p>{text.tournaments.noLive}</p>
                <p>
                  {ar
                    ? "تعرّف على المواجهات القادمة والنتائج الأخيرة أدناه."
                    : "Get ready for the next series. The schedule and latest results are below."}
                </p>
              </div>
            )}
          </section>
          <section aria-labelledby="home-next">
            <SectionHeading
              id="home-next"
              title={ar ? "المواجهات القادمة" : "Up next"}
              href={href("/live?tab=upcoming")}
              action={ar ? "الجدول الكامل" : "Full schedule"}
            />
            {matches.upcoming.length ? (
              <ScheduleGroup
                items={matches.upcoming.slice(0, 6)}
                locale={locale}
              />
            ) : (
              <div className="ec-empty">
                <p>{text.tournaments.noUpcoming}</p>
                <Link href={href("/tournaments")} className="ec-text-link">
                  {text.common.tournaments}
                  <ArrowRightIcon className="size-4 rtl:rotate-180" />
                </Link>
              </div>
            )}
          </section>
          <section aria-labelledby="home-results">
            <SectionHeading
              id="home-results"
              title={ar ? "آخر النتائج" : "Latest results"}
              href={href("/live?tab=results")}
              action={ar ? "عرض النتائج" : "All results"}
            />
            {matches.recentFinished.length ? (
              matches.recentFinished
                .slice(0, 4)
                .map((item) => (
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
          <section>
            <SectionHeading
              title={ar ? "تابع لعبتك" : "Follow your game"}
              href={href("/games")}
              action={ar ? "كل الألعاب" : "All games"}
            />
            <div className="ec-game-strip">
              {games.slice(0, 9).map((game) => (
                <Link
                  key={game.slug}
                  href={href(`/games/${game.slug}`)}
                  className="ec-game-link"
                >
                  <GameLogoMark
                    slug={game.slug}
                    className="size-8"
                    iconClassName="size-6"
                  />
                  <bdi>{localizeText(game.title, locale)}</bdi>
                </Link>
              ))}
            </div>
          </section>
        </div>
        <aside
          className="ec-desk-aside"
          aria-label={
            ar ? "أخبار وبطولات المجتمع" : "Community news and tournaments"
          }
        >
          <section>
            <SectionHeading
              title={ar ? "في دائرة المنافسة" : "In competition"}
              href={href("/tournaments")}
              action={ar ? "الكل" : "All events"}
            />
            {events.map((event) => (
              <Link
                href={href(`/tournaments/${event.id}`)}
                key={event.id}
                className="ec-event-row"
              >
                <GameLogoMark
                  slug={event.game}
                  className="size-10"
                  iconClassName="size-7"
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
                    {gameTitleForSlug(event.game, games, locale)} ·{" "}
                    {event.matchCounts.scheduled
                      ? `${formatNumber(event.matchCounts.scheduled, locale)} ${ar ? "مباراة قادمة" : "upcoming"}`
                      : text.tournaments.finished}
                  </p>
                </div>
              </Link>
            ))}
          </section>
          <section>
            <SectionHeading
              title={text.common.news}
              href={href("/news")}
              action={ar ? "غرفة الأخبار" : "Newsroom"}
            />
            {posts.map((post, index) => (
              <NewsStory
                key={post.id}
                post={post}
                locale={locale}
                label={
                  post.gameSlug
                    ? gameTitleForSlug(post.gameSlug, games, locale)
                    : text.common.media
                }
                featured={index === 0}
              />
            ))}
            {!posts.length ? (
              <div className="ec-empty">
                <p>
                  {ar
                    ? "أخبار المجتمع قريبًا."
                    : "Community stories are on their way."}
                </p>
              </div>
            ) : null}
          </section>
          {mvp ? (
            <section>
              <SectionHeading
                title={ar ? "أفضل لاعب اليوم" : "Community MVP"}
                href={href("/mvp")}
                action={ar ? "التصويت" : "View vote"}
              />
              <Link className="ec-event-row" href={href("/mvp")}>
                <ProfileAvatar
                  src={mvp.winner.imageUrl}
                  name={mvp.winner.displayName}
                  className="size-12"
                />
                <div>
                  <TrophyIcon className="size-4 text-primary" />
                  <h3 dir="auto">{mvp.winner.displayName}</h3>
                  <p dir="auto">{mvp.winner.teamName}</p>
                </div>
              </Link>
            </section>
          ) : null}
        </aside>
      </div>
      <LiveCoStreamsStrip locale={locale} />
      <PartnerPlacement kind="homepage" locale={locale} />
      {matches.attribution ? (
        <OfficialTournamentAttribution value={matches.attribution} />
      ) : null}
    </main>
  );
}
