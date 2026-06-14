import Link from "next/link";
import { ArrowRightIcon, TrophyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { localizeText } from "@/lib/community-content";
import { listGamesCached } from "@/lib/games";
import { copy, formatNumber, localizedPath } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import {
  listTournamentSummariesCached,
  type TournamentSummary,
} from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const locale = await getRequestLocale();
  const text = copy[locale].tournaments;
  const common = copy[locale].common;
  const [tournaments, games] = await Promise.all([
    listTournamentSummariesCached(),
    listGamesCached(),
  ]);

  const gameTitle = (slug: string) => {
    const game = games.find((g) => g.slug === slug);
    return game ? localizeText(game.title, locale) : slug;
  };

  // Only count live + upcoming; drop tournaments whose matches are all finished
  // so the list stays short and focused on what's actually on.
  const active = tournaments.filter(
    (t) => t.matchCounts.running > 0 || t.matchCounts.scheduled > 0,
  );

  // Group by game, then sort games (most live first) and tournaments within.
  const byGame = new Map<string, TournamentSummary[]>();
  for (const t of active) {
    const key = t.game ?? "other";
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key)!.push(t);
  }
  const groups = [...byGame.entries()]
    .map(([slug, list]) => ({
      slug,
      title: gameTitle(slug),
      live: list.reduce((n, t) => n + t.matchCounts.running, 0),
      upcoming: list.reduce((n, t) => n + t.matchCounts.scheduled, 0),
      tournaments: [...list].sort(
        (a, b) =>
          b.matchCounts.running - a.matchCounts.running ||
          b.matchCounts.scheduled - a.matchCounts.scheduled,
      ),
    }))
    .sort(
      (a, b) => b.live - a.live || b.upcoming - a.upcoming || a.title.localeCompare(b.title),
    );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-5 py-10 sm:px-8">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: common.tournaments },
        ]}
      />
      <section className="flex max-w-3xl flex-col items-start gap-4">
        <Badge variant="outline">
          <TrophyIcon data-icon="inline-start" />
          {text.eyebrow}
        </Badge>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{text.title}</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">{text.description}</p>
        </div>
      </section>

      {groups.length ? (
        <section className="flex flex-col gap-5">
          {groups.map((group) => (
            <Card key={group.slug} size="sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base capitalize">{group.title}</CardTitle>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {group.live > 0 ? (
                      <Badge className="gap-1.5 border-primary/35 bg-primary/10 text-primary">
                        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                        {formatNumber(group.live, locale)} {text.live}
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground">
                      {formatNumber(group.upcoming, locale)} {text.upcoming}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {group.tournaments.map((t) => (
                  <Link
                    key={t.id}
                    href={localizedPath(`/tournaments/${t.id}`, locale)}
                    className="group flex items-center gap-3 rounded-md px-2.5 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t.matchCounts.running > 0 ? (
                      <span
                        aria-hidden
                        title={text.liveNow}
                        className="size-2 shrink-0 rounded-full bg-primary"
                      />
                    ) : (
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-border" />
                    )}
                    <span dir="auto" className="min-w-0 flex-1 truncate text-sm">
                      {t.name || `#${formatNumber(t.id, locale)}`}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t.matchCounts.running > 0 ? (
                        <span className="font-semibold text-primary">
                          {formatNumber(t.matchCounts.running, locale)} {text.live}
                        </span>
                      ) : null}
                      {t.matchCounts.running > 0 && t.matchCounts.scheduled > 0 ? " · " : null}
                      {t.matchCounts.scheduled > 0 ? (
                        <span>
                          {formatNumber(t.matchCounts.scheduled, locale)} {text.upcoming}
                        </span>
                      ) : null}
                    </span>
                    <ArrowRightIcon
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                    />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{text.empty}</p>
      )}

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
