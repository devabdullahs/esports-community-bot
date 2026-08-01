"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DotaPlayerTable, ValorantPlayerTable } from "@/components/matches/player-table";
import type {
  BattleRoyaleDetails,
  DotaDetails,
  DotaTeamStats,
  IndividualDetails,
  MatchDetailsViewModel,
  OfficialBattleRoyaleDetails,
  TeamSeriesDetails,
  ValorantDetails,
} from "@/lib/match-details";
import { copy, type Locale } from "@/lib/i18n";
import { logoProxyUrl } from "@/lib/logo-url";
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
  matchDetailsSections: string;
  matchDetailsMap: (number: number) => string;
  matchDetailsGold: string;
  matchDetailsTowers: string;
  matchDetailsBarracks: string;
  matchDetailsRoshans: string;
  matchDetailsGameResults: string;
  matchDetailsRank: string;
  matchDetailsTeam: string;
  matchDetailsPlacement: string;
  matchDetailsKills: string;
  matchDetailsPoints: string;
  matchDetailsMode: string;
  matchDetailsPickedBy: string;
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

export function BattleRoyaleResults({
  details,
  text,
}: {
  details: BattleRoyaleDetails;
  text: MatchDetailsCopy;
}) {
  return (
    <div className="flex flex-col gap-4">
      <DetailsMetadata details={details} text={text} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{text.matchDetailsGameResults}</h2>
        {details.gameNumber ? (
          <Badge variant="secondary">{text.matchDetailsGame(details.gameNumber)}</Badge>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 px-3 text-center">{text.matchDetailsRank}</TableHead>
            <TableHead className="min-w-52 px-3 text-start">{text.matchDetailsTeam}</TableHead>
            <TableHead className="px-3 text-center">{text.matchDetailsPlacement}</TableHead>
            <TableHead className="px-3 text-center">{text.matchDetailsKills}</TableHead>
            <TableHead className="px-3 text-center">{text.matchDetailsPoints}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {details.entries.map((entry, index) => (
            <TableRow key={`${entry.team}-${index}`}>
              <TableCell className="px-3 text-center tabular-nums" dir="ltr">
                {entry.rank ?? index + 1}
              </TableCell>
              <TableCell className="px-3">
                <div className="flex min-w-48 items-center gap-3">
                  <Avatar size="sm">
                    {entry.logo ? <AvatarImage src={logoProxyUrl(entry.logo)} alt="" /> : null}
                    <AvatarFallback>{entry.team.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <bdi className="font-medium">{entry.team}</bdi>
                </div>
              </TableCell>
              <TableCell className="px-3 text-center tabular-nums" dir="ltr">
                {entry.placement ?? "-"}
              </TableCell>
              <TableCell className="px-3 text-center tabular-nums" dir="ltr">
                {entry.kills ?? "-"}
              </TableCell>
              <TableCell className="px-3 text-center font-semibold tabular-nums" dir="ltr">
                {entry.points ?? "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

function DotaTeamStats({ stats, text }: { stats: DotaTeamStats; text: MatchDetailsCopy }) {
  const kda = [stats.kills, stats.deaths, stats.assists].every((value) => value != null)
    ? `${stats.kills}/${stats.deaths}/${stats.assists}`
    : "-";
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" dir="ltr">
      <dt className="text-muted-foreground">KDA</dt><dd className="text-end tabular-nums">{kda}</dd>
      <dt className="text-muted-foreground">{text.matchDetailsGold}</dt><dd className="text-end tabular-nums">{stats.gold ?? "-"}</dd>
      <dt className="text-muted-foreground">{text.matchDetailsTowers}</dt><dd className="text-end tabular-nums">{stats.towers ?? "-"}</dd>
      <dt className="text-muted-foreground">{text.matchDetailsBarracks}</dt><dd className="text-end tabular-nums">{stats.barracks ?? "-"}</dd>
      <dt className="text-muted-foreground">{text.matchDetailsRoshans}</dt><dd className="text-end tabular-nums">{stats.roshans ?? "-"}</dd>
    </dl>
  );
}

function ValorantMaps({
  details,
  teamA,
  teamB,
  locale,
  text,
}: {
  details: ValorantDetails;
  teamA: string;
  teamB: string;
  locale: Locale;
  text: MatchDetailsCopy;
}) {
  return (
    <Accordion
      defaultValue={details.maps.length ? ["map-0"] : []}
      className="overflow-hidden rounded-xl border"
    >
      {details.maps.map((map, index) => (
        <AccordionItem key={`${map.name}-${index}`} value={`map-${index}`}>
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pe-2" dir="ltr">
              <span className="truncate">{map.name ?? text.matchDetailsMap(index + 1)}</span>
              <span className="tabular-nums text-muted-foreground">{map.duration ?? "-"}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-5 px-4 pb-4">
            <ScoreStrip teamA={teamA} teamB={teamB} scoreA={map.scoreA} scoreB={map.scoreB} winner={map.winner} />
            {(["a", "b"] as const).map((team) => (
              <section key={team} className="flex flex-col gap-2">
                <h3 className="font-medium" dir="ltr">{team === "a" ? teamA : teamB}</h3>
                <ValorantPlayerTable players={map.players[team]} locale={locale} />
              </section>
            ))}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function DotaGames({ details, teamA, teamB, locale, text }: { details: DotaDetails; teamA: string; teamB: string; locale: Locale; text: MatchDetailsCopy }) {
  return (
    <Accordion
      defaultValue={details.games.length ? ["game-0"] : []}
      className="overflow-hidden rounded-xl border"
    >
      {details.games.map((game, index) => (
        <AccordionItem key={game.number ?? index} value={`game-${index}`}>
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pe-2">
              <span>{text.matchDetailsGame(game.number ?? index + 1)}</span>
              <span className="tabular-nums text-muted-foreground" dir="ltr">
                {text.matchDetailsDuration}: {game.duration ?? "-"}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-5 px-4 pb-4">
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
                    <DotaTeamStats stats={game.teamStats[team]} text={text} />
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
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function IndividualResult({
  details,
  teamA,
  teamB,
}: {
  details: IndividualDetails;
  teamA: string;
  teamB: string;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      {details.round ? <h2 className="text-lg font-semibold" dir="auto">{details.round}</h2> : null}
      <ScoreStrip
        teamA={teamA}
        teamB={teamB}
        scoreA={details.scoreA}
        scoreB={details.scoreB}
        winner={
          details.scoreA != null && details.scoreB != null
            ? details.scoreA > details.scoreB
              ? "a"
              : details.scoreB > details.scoreA
                ? "b"
                : null
            : null
        }
      />
      {details.penaltyA != null || details.penaltyB != null ? (
        <p className="text-center text-sm text-muted-foreground" dir="ltr">
          Penalties: {score(details.penaltyA)} - {score(details.penaltyB)}
        </p>
      ) : null}
    </section>
  );
}

function TeamSeries({
  details,
  teamA,
  teamB,
  text,
}: {
  details: TeamSeriesDetails;
  teamA: string;
  teamB: string;
  text: MatchDetailsCopy;
}) {
  return (
    <div className="flex flex-col gap-3">
      {details.maps.map((map, index) => (
        <section key={`${map.name}-${map.round}-${index}`} className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold" dir="auto">{map.name ?? text.matchDetailsMap(index + 1)}</h2>
              {map.mode ? <Badge variant="secondary">{map.mode}</Badge> : null}
            </div>
            {map.round ? <span className="text-sm text-muted-foreground" dir="auto">{map.round}</span> : null}
          </div>
          <ScoreStrip
            teamA={teamA}
            teamB={teamB}
            scoreA={map.scoreA}
            scoreB={map.scoreB}
            winner={
              map.winner && map.winner.toLowerCase() === teamA.toLowerCase()
                ? "a"
                : map.winner && map.winner.toLowerCase() === teamB.toLowerCase()
                  ? "b"
                  : null
            }
          />
          {map.bans ? (
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
              {([["a", teamA, map.bans.a], ["b", teamB, map.bans.b]] as const).map(([side, team, ban]) => (
                <div key={side} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground" dir="auto">
                    {team} · {text.matchDetailsBans}
                  </span>
                  <span className="text-sm" dir="auto">
                    {ban?.hero ?? "-"}
                    {ban?.order != null ? ` #${ban.order}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {map.pickedBy ? (
            <span className="text-xs text-muted-foreground" dir="auto">
              {text.matchDetailsPickedBy}: {map.pickedBy}
            </span>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function BattleRoyaleGame({ details, locale }: { details: OfficialBattleRoyaleDetails; locale: Locale }) {
  const labels = locale === "ar"
    ? { rank: "المركز", team: "الفريق", placement: "التمركز", eliminations: "الإقصاءات", total: "المجموع" }
    : { rank: "Rank", team: "Team", placement: "Placement", eliminations: "Eliminations", total: "Total" };
  return (
    <section className="overflow-hidden rounded-xl border">
      {details.gameLabel ? <h2 className="border-b px-4 py-3 font-semibold" dir="auto">{details.gameLabel}</h2> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-start">{labels.rank}</th>
              <th className="px-4 py-3 text-start">{labels.team}</th>
              <th className="px-4 py-3 text-end">{labels.placement}</th>
              <th className="px-4 py-3 text-end">{labels.eliminations}</th>
              <th className="px-4 py-3 text-end">{labels.total}</th>
            </tr>
          </thead>
          <tbody>
            {details.standings.map((entry, index) => (
              <tr key={`${entry.rank}-${entry.team}-${index}`} className="border-t">
                <td className="px-4 py-3 tabular-nums">{entry.rank ?? "-"}</td>
                <td className="px-4 py-3 font-medium" dir="auto">{entry.team ?? "-"}</td>
                <td className="px-4 py-3 text-end tabular-nums">{entry.placementPoints ?? "-"}</td>
                <td className="px-4 py-3 text-end tabular-nums">{entry.eliminationPoints ?? "-"}</td>
                <td className="px-4 py-3 text-end font-semibold tabular-nums">{entry.totalPoints ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
  const text = copy[locale].tournaments;
  if (details.kind === "individual") {
    return <IndividualResult details={details} teamA={teamA} teamB={teamB} />;
  }
  if (details.kind === "teamSeries") {
    return <TeamSeries details={details} teamA={teamA} teamB={teamB} text={text} />;
  }
  if (details.kind === "battleRoyale") {
    return <BattleRoyaleGame details={details} locale={locale} />;
  }
  if (details.kind === "battle-royale") {
    return <BattleRoyaleResults details={details} text={text} />;
  }
  const isValorant = details.kind === "valorant";
  return (
    <Tabs defaultValue="overview" className="gap-5">
      <TabsList variant="line" aria-label={text.matchDetailsSections}>
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
          <ValorantMaps details={details} teamA={teamA} teamB={teamB} locale={locale} text={text} />
        ) : (
          <DotaGames details={details} teamA={teamA} teamB={teamB} locale={locale} text={text} />
        )}
      </TabsContent>
    </Tabs>
  );
}
