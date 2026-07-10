"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DotaPlayerTable, ValorantPlayerTable } from "@/components/matches/player-table";
import type { DotaDetails, DotaTeamStats, MatchDetailsViewModel, ValorantDetails } from "@/lib/match-details";
import { copy, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Side = "a" | "b";
type MatchDetailsCopy = {
  matchDetailsOverview: string;
  matchDetailsMaps: string;
  matchDetailsGames: string;
  matchDetailsVeto: string;
  matchDetailsDraft: string;
  matchDetailsPatch: string;
  matchDetailsCasters: string;
  matchDetailsPicks: string;
  matchDetailsBans: string;
  matchDetailsTeamStats: string;
  matchDetailsPlayerPerformance: string;
  matchDetailsShowMore: (count: number) => string;
  matchDetailsShowLess: string;
  matchDetailsDuration: string;
  matchDetailsGame: (number: number) => string;
};

function score(value: number | null) {
  return value ?? "-";
}

function ScoreStrip({
  teamA,
  teamB,
  scoreA,
  scoreB,
  winner,
}: {
  teamA: string;
  teamB: string;
  scoreA: number | null;
  scoreB: number | null;
  winner: Side | null;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm" dir="ltr">
      <span className={cn("truncate font-medium", winner === "a" && "text-primary")}>{teamA}</span>
      <span className="tabular-nums font-semibold">{score(scoreA)} - {score(scoreB)}</span>
      <span className={cn("truncate text-end font-medium", winner === "b" && "text-primary")}>{teamB}</span>
    </div>
  );
}

function DetailsMetadata({ details, text }: { details: MatchDetailsViewModel; text: MatchDetailsCopy }) {
  if (!details.patch && !details.casters.length) return null;
  return (
    <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
      {details.patch ? (
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium text-muted-foreground">{text.matchDetailsPatch}</dt>
          <dd className="font-medium" dir="ltr">{details.patch}</dd>
        </div>
      ) : null}
      {details.casters.length ? (
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium text-muted-foreground">{text.matchDetailsCasters}</dt>
          <dd className="font-medium" dir="ltr">{details.casters.join(", ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function ValorantOverview({ details, text }: { details: ValorantDetails; text: MatchDetailsCopy }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailsMetadata details={details} text={text} />
      {details.veto.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{text.matchDetailsVeto}</h2>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {details.veto.map((entry) => (
              <li key={`${entry.order}-${entry.map}`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2" dir="ltr">
                <span className="min-w-0 truncate font-medium">{entry.map ?? "-"}</span>
                <span className="shrink-0 text-xs uppercase text-muted-foreground">{entry.action}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function DraftList({ title, entries }: { title: string; entries: { hero: string | null; order: number | null }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <span className="text-sm" dir="ltr">
        {entries.length ? entries.map((entry) => `${entry.hero ?? "-"} #${entry.order ?? "-"}`).join(", ") : "-"}
      </span>
    </div>
  );
}

function DotaDraft({
  details,
  teamA,
  teamB,
  text,
}: {
  details: DotaDetails;
  teamA: string;
  teamB: string;
  text: MatchDetailsCopy;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{text.matchDetailsDraft}</h2>
      <div className="grid gap-3">
        {details.games.map((game, index) => (
          <div key={game.number ?? index} className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
            {(["a", "b"] as const).map((team) => (
              <div key={team} className="flex flex-col gap-3">
                <span className="font-medium" dir="ltr">{team === "a" ? teamA : teamB}</span>
                <DraftList title={text.matchDetailsPicks} entries={game.draft[team].picks} />
                <DraftList title={text.matchDetailsBans} entries={game.draft[team].bans} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function DotaOverview({ details, teamA, teamB, text }: { details: DotaDetails; teamA: string; teamB: string; text: MatchDetailsCopy }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailsMetadata details={details} text={text} />
      <DotaDraft details={details} teamA={teamA} teamB={teamB} text={text} />
    </div>
  );
}

function DotaTeamStats({ stats }: { stats: DotaTeamStats }) {
  const kda = [stats.kills, stats.deaths, stats.assists].every((value) => value != null)
    ? `${stats.kills}/${stats.deaths}/${stats.assists}`
    : "-";
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" dir="ltr">
      <dt className="text-muted-foreground">KDA</dt><dd className="text-end tabular-nums">{kda}</dd>
      <dt className="text-muted-foreground">Gold</dt><dd className="text-end tabular-nums">{stats.gold ?? "-"}</dd>
      <dt className="text-muted-foreground">Towers</dt><dd className="text-end tabular-nums">{stats.towers ?? "-"}</dd>
      <dt className="text-muted-foreground">Barracks</dt><dd className="text-end tabular-nums">{stats.barracks ?? "-"}</dd>
      <dt className="text-muted-foreground">Roshans</dt><dd className="text-end tabular-nums">{stats.roshans ?? "-"}</dd>
    </dl>
  );
}

function ValorantMaps({ details, teamA, teamB, locale }: { details: ValorantDetails; teamA: string; teamB: string; locale: Locale }) {
  return (
    <div className="flex flex-col gap-3">
      {details.maps.map((map, index) => (
        <details key={`${map.name}-${index}`} className="rounded-xl border p-4" open={index === 0}>
          <summary className="cursor-pointer list-none font-semibold">
            <div className="flex items-center justify-between gap-3" dir="ltr">
              <span>{map.name ?? `Map ${index + 1}`}</span>
              <span className="tabular-nums text-muted-foreground">{map.duration ?? "-"}</span>
            </div>
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            <ScoreStrip teamA={teamA} teamB={teamB} scoreA={map.scoreA} scoreB={map.scoreB} winner={map.winner} />
            {(["a", "b"] as const).map((team) => (
              <section key={team} className="flex flex-col gap-2">
                <h3 className="font-medium" dir="ltr">{team === "a" ? teamA : teamB}</h3>
                <ValorantPlayerTable players={map.players[team]} locale={locale} />
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function DotaGames({ details, teamA, teamB, locale, text }: { details: DotaDetails; teamA: string; teamB: string; locale: Locale; text: MatchDetailsCopy }) {
  return (
    <div className="flex flex-col gap-3">
      {details.games.map((game, index) => (
        <details key={game.number ?? index} className="rounded-xl border p-4" open={index === 0}>
          <summary className="cursor-pointer list-none font-semibold">
            <div className="flex items-center justify-between gap-3">
              <span>{text.matchDetailsGame(game.number ?? index + 1)}</span>
              <span className="tabular-nums text-muted-foreground" dir="ltr">
                {text.matchDetailsDuration}: {game.duration ?? "-"}
              </span>
            </div>
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            <ScoreStrip
              teamA={teamA}
              teamB={teamB}
              scoreA={game.teamStats.a.kills}
              scoreB={game.teamStats.b.kills}
              winner={game.winner}
            />
            <section className="flex flex-col gap-2">
              <h3 className="font-medium">{text.matchDetailsTeamStats}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["a", "b"] as const).map((team) => (
                  <div key={team} className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                    <span className="font-medium" dir="ltr">{team === "a" ? teamA : teamB} · {game.sides[team] ?? "-"}</span>
                    <DotaTeamStats stats={game.teamStats[team]} />
                  </div>
                ))}
              </div>
            </section>
            {(["a", "b"] as const).map((team) => (
              <section key={team} className="flex flex-col gap-2">
                <h3 className="font-medium" dir="ltr">{text.matchDetailsPlayerPerformance} · {team === "a" ? teamA : teamB}</h3>
                <DotaPlayerTable players={game.players[team]} locale={locale} />
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export function MatchDetailTabs({
  details,
  teamA,
  teamB,
  locale,
}: {
  details: MatchDetailsViewModel;
  teamA: string;
  teamB: string;
  locale: Locale;
}) {
  const isValorant = details.kind === "valorant";
  const text = copy[locale].tournaments;
  return (
    <Tabs defaultValue="overview" className="gap-5">
      <TabsList variant="line" aria-label="Match details sections">
        <TabsTrigger value="overview">{text.matchDetailsOverview}</TabsTrigger>
        <TabsTrigger value="detail">{isValorant ? text.matchDetailsMaps : text.matchDetailsGames}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        {isValorant ? (
          <ValorantOverview details={details} text={text} />
        ) : (
          <DotaOverview details={details} teamA={teamA} teamB={teamB} text={text} />
        )}
      </TabsContent>
      <TabsContent value="detail">
        {isValorant ? (
          <ValorantMaps details={details} teamA={teamA} teamB={teamB} locale={locale} />
        ) : (
          <DotaGames details={details} teamA={teamA} teamB={teamB} locale={locale} text={text} />
        )}
      </TabsContent>
    </Tabs>
  );
}
