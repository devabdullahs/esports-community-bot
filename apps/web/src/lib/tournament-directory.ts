import type { MatchCounts, MatchStatus } from "@/lib/tournaments";
import type { ResultReason, WinnerSide } from "@/lib/match-lifecycle";

export type TournamentStatusFilter = "all" | "live" | "upcoming" | "results";
export const TOURNAMENT_STATUS_FILTERS = ["all", "live", "upcoming", "results"] as const;

export type TournamentDirectoryMatch = {
  id: number;
  name: string | null;
  team_a: string | null;
  team_b: string | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  status: MatchStatus;
  winner_side?: WinnerSide;
  result_reason?: ResultReason;
  scheduled_at: number | null;
};

export type TournamentDirectoryItem = {
  id: number;
  name: string | null;
  game: string | null;
  gameTitle: string;
  source: string;
  sourceLabel: string;
  url: string | null;
  ewc: boolean;
  matchCounts: MatchCounts;
  featuredMatch: TournamentDirectoryMatch | null;
};

export type TournamentDirectoryFilters = {
  query?: string;
  status?: TournamentStatusFilter;
  game?: string;
  source?: string;
  ewc?: boolean;
};

export type NormalizedTournamentDirectoryFilters = {
  query: string;
  status: TournamentStatusFilter;
  game: string;
  source: string;
  ewc: boolean;
};

export type TournamentDirectoryOptionCount = {
  value: string;
  count: number;
};

export type TournamentDirectoryFilterCounts = {
  statuses: Record<TournamentStatusFilter, number>;
  games: TournamentDirectoryOptionCount[];
  sources: TournamentDirectoryOptionCount[];
  allGames: number;
  allSources: number;
};

type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | null | undefined>;

function firstParam(params: SearchParamsLike, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function parseTournamentDirectoryFilters(
  params: SearchParamsLike,
  {
    games = [],
    sources = [],
  }: {
    games?: Iterable<string>;
    sources?: Iterable<string>;
  } = {},
): NormalizedTournamentDirectoryFilters {
  const allowedGames = new Set(games);
  const allowedSources = new Set(sources);
  const rawStatus = firstParam(params, "status");
  const rawGame = firstParam(params, "game");
  const rawSource = firstParam(params, "source");
  const query = (firstParam(params, "q") ?? "").trim().slice(0, 120);

  return {
    query,
    status: TOURNAMENT_STATUS_FILTERS.includes(rawStatus as TournamentStatusFilter)
      ? (rawStatus as TournamentStatusFilter)
      : "all",
    game: rawGame && allowedGames.has(rawGame) ? rawGame : "all",
    source: rawSource && allowedSources.has(rawSource) ? rawSource : "all",
    ewc: firstParam(params, "ewc") === "1",
  };
}

export function serializeTournamentDirectoryFilters(
  filters: TournamentDirectoryFilters,
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of ["q", "status", "game", "source", "ewc", "page"]) params.delete(key);

  const query = filters.query?.trim().slice(0, 120) ?? "";
  const status = filters.status ?? "all";
  const game = filters.game ?? "all";
  const source = filters.source ?? "all";
  const ewc = filters.ewc ?? false;
  if (query) params.set("q", query);
  if (status !== "all") params.set("status", status);
  if (game !== "all") params.set("game", game);
  if (source !== "all") params.set("source", source);
  if (ewc) params.set("ewc", "1");
  return params;
}

export function sourceLabel(source: string): string {
  const key = source.trim().toLowerCase();
  if (key === "startgg") return "start.gg";
  if (key === "liquipedia") return "Liquipedia";
  if (key === "pandascore") return "PandaScore";
  return source || "Source";
}

export function tournamentPrimaryStatus(
  tournament: Pick<TournamentDirectoryItem, "matchCounts">,
): Exclude<TournamentStatusFilter, "all"> | "idle" {
  if (tournament.matchCounts.running > 0) return "live";
  if (tournament.matchCounts.scheduled > 0) return "upcoming";
  if (tournament.matchCounts.finished > 0) return "results";
  return "idle";
}

export function tournamentMatchesStatus(
  tournament: Pick<TournamentDirectoryItem, "matchCounts">,
  status: TournamentStatusFilter,
): boolean {
  if (status === "all") return true;
  return tournamentPrimaryStatus(tournament) === status;
}

export function filterTournamentDirectory(
  tournaments: TournamentDirectoryItem[],
  filters: TournamentDirectoryFilters,
): TournamentDirectoryItem[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  const status = filters.status ?? "all";
  const game = filters.game ?? "all";
  const source = filters.source ?? "all";
  const ewc = filters.ewc ?? false;

  return tournaments
    .filter((tournament) => {
      if (!tournamentMatchesStatus(tournament, status)) return false;
      if (game !== "all" && (tournament.game ?? "other") !== game) return false;
      if (source !== "all" && tournament.source !== source) return false;
      if (ewc && !tournament.ewc) return false;
      if (!query) return true;

      const searchable = [
        tournament.name,
        tournament.game,
        tournament.gameTitle,
        tournament.source,
        tournament.sourceLabel,
        tournament.featuredMatch?.team_a,
        tournament.featuredMatch?.team_b,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    })
    .sort(tournamentDirectorySorter);
}

export function tournamentDirectoryStats(tournaments: TournamentDirectoryItem[]) {
  const uniqueGames = new Set(tournaments.map((tournament) => tournament.game ?? "other"));
  return {
    tournaments: tournaments.length,
    games: uniqueGames.size,
    live: tournaments.filter((tournament) => tournamentPrimaryStatus(tournament) === "live").length,
    upcoming: tournaments.filter((tournament) => tournamentPrimaryStatus(tournament) === "upcoming").length,
    results: tournaments.filter((tournament) => tournamentPrimaryStatus(tournament) === "results").length,
  };
}

export function tournamentDirectoryFilterCounts(
  tournaments: TournamentDirectoryItem[],
  filters: TournamentDirectoryFilters,
): TournamentDirectoryFilterCounts {
  const statusPool = filterTournamentDirectory(tournaments, { ...filters, status: "all" });
  const gamePool = filterTournamentDirectory(tournaments, { ...filters, game: "all" });
  const sourcePool = filterTournamentDirectory(tournaments, { ...filters, source: "all" });
  const statusCounts: Record<TournamentStatusFilter, number> = {
    all: statusPool.length,
    live: 0,
    upcoming: 0,
    results: 0,
  };
  for (const tournament of statusPool) {
    const primary = tournamentPrimaryStatus(tournament);
    if (primary !== "idle") statusCounts[primary] += 1;
  }

  const games = countBy(gamePool, (tournament) => tournament.game ?? "other");
  const sources = countBy(sourcePool, (tournament) => tournament.source);
  return {
    statuses: statusCounts,
    games,
    sources,
    allGames: gamePool.length,
    allSources: sourcePool.length,
  };
}

function countBy(
  tournaments: TournamentDirectoryItem[],
  valueFor: (tournament: TournamentDirectoryItem) => string,
): TournamentDirectoryOptionCount[] {
  const counts = new Map<string, number>();
  for (const tournament of tournaments) {
    const value = valueFor(tournament);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function statusWeight(tournament: TournamentDirectoryItem): number {
  const status = tournamentPrimaryStatus(tournament);
  if (status === "live") return 0;
  if (status === "upcoming") return 1;
  if (status === "results") return 2;
  return 3;
}

export function tournamentDirectorySorter(
  a: TournamentDirectoryItem,
  b: TournamentDirectoryItem,
): number {
  const primary = statusWeight(a) - statusWeight(b);
  if (primary) return primary;

  const status = tournamentPrimaryStatus(a);
  const timeA = a.featuredMatch?.scheduled_at ?? Number.MAX_SAFE_INTEGER;
  const timeB = b.featuredMatch?.scheduled_at ?? Number.MAX_SAFE_INTEGER;
  const relevantTime =
    status === "results" ? timeB - timeA : status === "live" || status === "upcoming" ? timeA - timeB : 0;
  if (relevantTime) return relevantTime;

  return (
    b.matchCounts.running - a.matchCounts.running ||
    b.matchCounts.scheduled - a.matchCounts.scheduled ||
    b.matchCounts.finished - a.matchCounts.finished ||
    a.gameTitle.localeCompare(b.gameTitle) ||
    (a.name ?? "").localeCompare(b.name ?? "")
  );
}
