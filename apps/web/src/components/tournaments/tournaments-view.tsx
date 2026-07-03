import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { TournamentDirectory } from "@/components/tournaments/tournament-directory";
import { LiquipediaAttribution } from "@/components/tournaments/liquipedia-attribution";
import { gameTitleForSlug, listGamesCached } from "@/lib/games";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { sourceLabel, type TournamentDirectoryItem } from "@/lib/tournament-directory";
import { listTournamentSummariesCached } from "@/lib/tournaments";

// Shared tournaments view. `ewcOnly` narrows the list to Esports World Cup
// events; otherwise every tracked tournament is shown.
export async function TournamentsView({
  locale,
  ewcOnly = false,
}: {
  locale: Locale;
  ewcOnly?: boolean;
}) {
  const text = copy[locale].tournaments;
  const common = copy[locale].common;
  const heading = ewcOnly ? common.ewcTournaments : text.title;

  const [tournaments, games] = await Promise.all([
    listTournamentSummariesCached(),
    listGamesCached(),
  ]);

  // Keep finished-only tournaments visible too. Some sources, especially
  // start.gg event brackets, may have no real upcoming rows once projected sets
  // are filtered out, but their result pages should remain reachable. Standings
  // events (battle royale, TFT groups) have zero matches by design — their
  // standings rows are what makes them worth listing.
  const scoped = ewcOnly ? tournaments.filter((t) => t.ewc) : tournaments;
  const active = scoped.filter(
    (t) =>
      t.matchCounts.running > 0 ||
      t.matchCounts.scheduled > 0 ||
      t.matchCounts.finished > 0 ||
      t.hasStandings,
  );
  const directoryItems: TournamentDirectoryItem[] = active.map((tournament) => {
    const game = tournament.game ?? "other";
    return {
      ...tournament,
      gameTitle: gameTitleForSlug(game, games, locale),
      sourceLabel: sourceLabel(tournament.source),
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-10">
      <PageBreadcrumb
        items={[
          { label: common.home, href: localizedPath("/", locale) },
          { label: heading },
        ]}
      />

      <TournamentDirectory
        locale={locale}
        heading={heading}
        tournaments={directoryItems}
        archiveHref={ewcOnly ? null : localizedPath("/tournaments/archive", locale)}
      />

      <LiquipediaAttribution locale={locale} />
    </main>
  );
}
