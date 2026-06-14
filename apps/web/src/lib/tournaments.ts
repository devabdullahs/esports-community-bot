import "server-only";

import { all } from "@bot/db/client.js";
import {
  getTournamentById as _getById,
  listActiveTournaments as _listActive,
} from "@bot/db/tournaments.js";
import { unstable_cache } from "next/cache";
import { resolveDefaultGuildId } from "@/lib/guild";

// ---------------------------------------------------------------------------
// Typed boundary over the bot's tournament/match read helpers (see games.ts).
// Phase 1 is read-only and public. Aggregations (per-status match counts and
// grouped per-tournament matches) are run here as parameterized reads against
// the shared bot DB via the unified async client ($1,$2,... placeholders work
// on both SQLite and Postgres) — the bot exposes no helper for them. We never
// write from the web process.
// ---------------------------------------------------------------------------

export type MatchStatus = "running" | "scheduled" | "finished";

export type TournamentRow = {
  id: number;
  source: string;
  external_id: string;
  game: string | null;
  name: string | null;
  url: string | null;
  guild_id: string;
  active: number;
  created_at: string;
};

export type MatchCounts = { running: number; scheduled: number; finished: number };

export type TournamentSummary = {
  id: number;
  name: string | null;
  game: string | null;
  source: string;
  url: string | null;
  active: number;
  created_at: string;
  ewc: boolean;
  matchCounts: MatchCounts;
};

export type MatchRow = {
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
  updated_at: string | null;
};

export type TournamentMatches = {
  tournament: { id: number; name: string | null; game: string | null; source: string; url: string | null };
  matches: { running: MatchRow[]; scheduled: MatchRow[]; finished: MatchRow[] };
  total: number;
};

const listActive = _listActive as (guildId?: string) => Promise<TournamentRow[]>;
const getById = _getById as (id: number) => Promise<TournamentRow | undefined>;

const COUNTS_SQL = `
  SELECT status, COUNT(*) AS n
  FROM matches
  WHERE tournament_id = $1
  GROUP BY status
`;

function zeroCounts(): MatchCounts {
  return { running: 0, scheduled: 0, finished: 0 };
}

// A tracked tournament belongs to the Esports World Cup when its Liquipedia page
// lives under a .../Esports_World_Cup/... path, or its display name says so (e.g.
// "FC Pro 26 World Championship at Esports World Cup 2026"). Distinct events such
// as "Overwatch World Cup" or "PUBG Mobile World Cup" intentionally do NOT match.
function isEwcTournament(t: {
  name: string | null;
  external_id: string;
  url: string | null;
}): boolean {
  const haystack = `${t.external_id} ${t.url ?? ""} ${t.name ?? ""}`.toLowerCase();
  return haystack.includes("esports_world_cup") || haystack.includes("esports world cup");
}

async function matchCountsFor(tournamentId: number): Promise<MatchCounts> {
  const counts = zeroCounts();
  const rows = (await all(COUNTS_SQL, [tournamentId])) as { status: string; n: number }[];
  for (const row of rows) {
    if (row.status === "running" || row.status === "scheduled" || row.status === "finished") {
      counts[row.status] = row.n;
    }
  }
  return counts;
}

const MATCH_COLUMNS =
  "id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, scheduled_at, updated_at";

// running first, then upcoming by start time, then finished most-recent first
// — mirrors getMatchesForGuild's ordering in src/db/matches.js.
const LIVE_SQL = `SELECT ${MATCH_COLUMNS} FROM matches WHERE tournament_id = $1 AND status = 'running' ORDER BY scheduled_at ASC`;
const UPCOMING_SQL = `SELECT ${MATCH_COLUMNS} FROM matches WHERE tournament_id = $1 AND status = 'scheduled' ORDER BY scheduled_at ASC`;
const FINISHED_SQL = `SELECT ${MATCH_COLUMNS} FROM matches WHERE tournament_id = $1 AND status = 'finished'
   ORDER BY scheduled_at DESC LIMIT $2 OFFSET $3`;

/** Active tournaments for the configured guild, each with per-status match counts. */
export async function listTournamentSummaries(): Promise<TournamentSummary[]> {
  // The bot only renders match cards for active tournaments (getMatchesForGuild
  // joins on t.active = 1), so listActiveTournaments mirrors exactly what Discord
  // shows. The only gap was the guild id, now DB-derived.
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  const tournaments = await listActive(guildId);
  return Promise.all(
    tournaments.map(async (t) => ({
      id: t.id,
      name: t.name,
      game: t.game,
      source: t.source,
      url: t.url,
      active: t.active,
      created_at: t.created_at,
      ewc: isEwcTournament(t),
      matchCounts: await matchCountsFor(t.id),
    })),
  );
}

/**
 * Matches for one tournament grouped by status. Pagination (limit/offset)
 * applies only to the finished list; running + scheduled are returned in full.
 * Returns null when the tournament is missing or belongs to another guild.
 */
export async function getTournamentMatches(
  id: number,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<TournamentMatches | null> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return null;
  const tournament = await getById(id);
  if (!tournament || tournament.guild_id !== guildId || tournament.active !== 1) return null;

  const running = (await all(LIVE_SQL, [id])) as MatchRow[];
  const scheduled = (await all(UPCOMING_SQL, [id])) as MatchRow[];
  const finished = (await all(FINISHED_SQL, [id, limit, offset])) as MatchRow[];
  const total = await matchCountsFor(id);

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      game: tournament.game,
      source: tournament.source,
      url: tournament.url,
    },
    matches: { running, scheduled, finished },
    total: total.running + total.scheduled + total.finished,
  };
}

// ---------------------------------------------------------------------------
// Cached public-read variants.
// Live data → short revalidate so scores refresh ~every minute even without an
// admin tag invalidation. Tag `cms-tournaments` lets future admin writes bust it.
// ---------------------------------------------------------------------------

export const listTournamentSummariesCached = unstable_cache(
  async () => listTournamentSummaries(),
  ["tournaments-list"],
  { tags: ["cms-tournaments"], revalidate: 60 },
);

export const getTournamentMatchesCached = unstable_cache(
  async (id: number, opts?: { limit?: number; offset?: number }) => getTournamentMatches(id, opts),
  ["tournament-matches"],
  { tags: ["cms-tournaments"], revalidate: 60 },
);
