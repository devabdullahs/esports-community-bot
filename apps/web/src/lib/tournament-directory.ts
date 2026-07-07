import type { MatchCounts, MatchStatus } from "@/lib/tournaments";

export type TournamentStatusFilter = "all" | "live" | "upcoming" | "results";

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
};

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
  if (status === "live") return tournament.matchCounts.running > 0;
  if (status === "upcoming") return tournament.matchCounts.scheduled > 0;
  return tournament.matchCounts.finished > 0;
}

export function filterTournamentDirectory(
  tournaments: TournamentDirectoryItem[],
  filters: TournamentDirectoryFilters,
): TournamentDirectoryItem[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  const status = filters.status ?? "all";
  const game = filters.game ?? "all";
  const source = filters.source ?? "all";

  return tournaments
    .filter((tournament) => {
      if (!tournamentMatchesStatus(tournament, status)) return false;
      if (game !== "all" && (tournament.game ?? "other") !== game) return false;
      if (source !== "all" && tournament.source !== source) return false;
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
    live: tournaments.filter((tournament) => tournament.matchCounts.running > 0).length,
    upcoming: tournaments.filter((tournament) => tournament.matchCounts.scheduled > 0).length,
    results: tournaments.filter((tournament) => tournament.matchCounts.finished > 0).length,
  };
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
