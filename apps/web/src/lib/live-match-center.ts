import "server-only";

import { unstable_cache } from "next/cache";
import {
  getTournamentMatchesCached,
  matchHasDetails,
  listTournamentSummariesCached,
  type MatchStream,
  type TournamentMatches,
} from "@/lib/tournaments";
import type { MatchCoStream } from "@/lib/match-co-streams";

export const LIVE_UPCOMING_LIMIT = 25;
export const LIVE_RECENT_FINISHED_LIMIT = 5;

export type LiveMatchCenterItem = {
  id: number;
  tournamentId: number;
  tournamentName: string | null;
  tournamentHref: string;
  game: string | null;
  name: string | null;
  teamA: string | null;
  teamB: string | null;
  logoA: string | null;
  logoB: string | null;
  scoreA: number | null;
  scoreB: number | null;
  status: "running" | "scheduled" | "finished";
  scheduledAt: number | null;
  detailsHref: string | null;
  stream: MatchStream | null;
  coStreams: MatchCoStream[];
};

export type LiveMatchCenter = {
  running: LiveMatchCenterItem[];
  upcoming: LiveMatchCenterItem[];
  recentFinished: LiveMatchCenterItem[];
};

function timeForAscending(value: number | null): number {
  return value == null || !Number.isFinite(value) ? Number.MAX_SAFE_INTEGER : value;
}

function timeForDescending(value: number | null): number {
  return value == null || !Number.isFinite(value) ? Number.MIN_SAFE_INTEGER : value;
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function toPublicMatch(
  tournament: TournamentMatches["tournament"],
  match: TournamentMatches["matches"]["running"][number],
): LiveMatchCenterItem {
  return {
    id: match.id,
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    tournamentHref: `/tournaments/${tournament.id}`,
    game: tournament.game,
    name: match.name,
    teamA: match.team_a,
    teamB: match.team_b,
    logoA: match.logo_a,
    logoB: match.logo_b,
    scoreA: match.score_a,
    scoreB: match.score_b,
    status: match.status,
    scheduledAt: match.scheduled_at,
    detailsHref: matchHasDetails(match.has_details) ? `/matches/${match.id}` : null,
    stream: match.stream ?? null,
    coStreams: (match.coStreams ?? []).map(({ platform, handle, label, url }) => ({
      platform,
      handle,
      label,
      url,
    })),
  };
}

/**
 * Builds a compact public view of the cached per-tournament match data. Keeping
 * the projection pure makes its ordering and redaction rules easy to test.
 */
export function buildLiveMatchCenter(rows: Array<TournamentMatches | null | undefined>): LiveMatchCenter {
  const running: LiveMatchCenterItem[] = [];
  const upcoming: LiveMatchCenterItem[] = [];
  const recentFinished: LiveMatchCenterItem[] = [];

  for (const row of rows) {
    if (!row) continue;
    running.push(...row.matches.running.map((match) => toPublicMatch(row.tournament, match)));
    upcoming.push(...row.matches.scheduled.map((match) => toPublicMatch(row.tournament, match)));
    recentFinished.push(...row.matches.finished.map((match) => toPublicMatch(row.tournament, match)));
  }

  running.sort((a, b) =>
    compareText(a.game, b.game)
    || timeForAscending(a.scheduledAt) - timeForAscending(b.scheduledAt)
    || a.id - b.id,
  );
  upcoming.sort((a, b) =>
    timeForAscending(a.scheduledAt) - timeForAscending(b.scheduledAt)
    || compareText(a.game, b.game)
    || a.id - b.id,
  );
  recentFinished.sort((a, b) =>
    timeForDescending(b.scheduledAt) - timeForDescending(a.scheduledAt)
    || a.id - b.id,
  );

  return {
    running,
    upcoming: upcoming.slice(0, LIVE_UPCOMING_LIMIT),
    recentFinished: recentFinished.slice(0, LIVE_RECENT_FINISHED_LIMIT),
  };
}

async function readLiveMatchCenter(): Promise<LiveMatchCenter> {
  const tournaments = await listTournamentSummariesCached();
  const rows = await Promise.all(
    tournaments.map((tournament) => getTournamentMatchesCached(tournament.id, {
      limit: LIVE_RECENT_FINISHED_LIMIT,
    })),
  );
  return buildLiveMatchCenter(rows);
}

// The individual helpers are also cached, but this combines the fan-out into a
// single short-lived public projection for server renders and client refreshes.
export const getLiveMatchCenter = unstable_cache(
  readLiveMatchCenter,
  ["live-match-center"],
  { tags: ["cms-tournaments"], revalidate: 60 },
);
