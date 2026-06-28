import "server-only";

import { all } from "@bot/db/client.js";
import { dedupeMatches as _dedupeMatches } from "@bot/db/matches.js";
import {
  getTournamentById as _getById,
  listActiveTournaments as _listActive,
} from "@bot/db/tournaments.js";
import { unstable_cache } from "next/cache";
import { resolveDefaultGuildId } from "@/lib/guild";
import { liveCoStreamsByMatch, type MatchCoStream } from "@/lib/match-co-streams";

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

export type MatchStream = { platform: string; url: string };

export type MatchRow = {
  id: number;
  external_id?: string;
  game?: string | null;
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
  // Raw columns (present on DB reads, omitted from the public projection).
  stream_platform?: string | null;
  stream_url?: string | null;
  // Official per-match broadcast stream (derived watch link), public projection.
  stream?: MatchStream | null;
  coStreams?: MatchCoStream[];
};

export type TournamentMatches = {
  tournament: { id: number; name: string | null; game: string | null; source: string; url: string | null };
  matches: { running: MatchRow[]; scheduled: MatchRow[]; finished: MatchRow[] };
  total: number;
};

const listActive = _listActive as (guildId?: string) => Promise<TournamentRow[]>;
const getById = _getById as (id: number) => Promise<TournamentRow | undefined>;
const dedupeMatches = _dedupeMatches as <T extends MatchRow>(rows: T[]) => T[];

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

const MATCH_COLUMNS =
  "id, external_id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, scheduled_at, stream_platform, stream_url, updated_at";

// The official per-match stream is the Liquipedia Special:Stream link, which
// resolves to the real channel (the path segment is Liquipedia's key, not the
// handle — see parseMatchStream). We surface that link as-is; platform drives the
// icon only. Only http(s) links are trusted.
export function matchStream(row: MatchRow): MatchStream | null {
  const platform = (row.stream_platform ?? "").toLowerCase();
  const raw = row.stream_url ?? "";
  if (!platform || !/^https?:\/\//i.test(raw)) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host !== "liquipedia.net" && !host.endsWith(".liquipedia.net")) return null;
  return { platform, url: raw };
}

// running first, then upcoming by start time, then finished most-recent first
// — mirrors getMatchesForGuild's ordering in src/db/matches.js.
const MATCHES_SQL = `SELECT ${MATCH_COLUMNS} FROM matches
   WHERE tournament_id = $1
     AND NOT (source = 'startgg' AND external_id LIKE 'sgg:preview_%')
   ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
            CASE WHEN status = 'finished' THEN scheduled_at END DESC,
            scheduled_at ASC`;

function publicMatch(row: MatchRow): MatchRow {
  return {
    id: row.id,
    name: row.name,
    team_a: row.team_a,
    team_b: row.team_b,
    logo_a: row.logo_a,
    logo_b: row.logo_b,
    score_a: row.score_a,
    score_b: row.score_b,
    status: row.status,
    scheduled_at: row.scheduled_at,
    updated_at: row.updated_at,
    stream: matchStream(row),
  };
}

async function dedupedTournamentMatches(tournament: TournamentRow): Promise<MatchRow[]> {
  const rows = ((await all(MATCHES_SQL, [tournament.id])) as MatchRow[]).map((row) => ({
    ...row,
    game: tournament.game,
  }));
  return dedupeMatches(rows);
}

function countsFromRows(rows: MatchRow[]): MatchCounts {
  const counts = zeroCounts();
  for (const row of rows) {
    if (row.status === "running" || row.status === "scheduled" || row.status === "finished") {
      counts[row.status] += 1;
    }
  }
  return counts;
}

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
      matchCounts: countsFromRows(await dedupedTournamentMatches(t)),
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

  const rows = await dedupedTournamentMatches(tournament);
  const rawRunning = rows.filter((m) => m.status === "running");
  const coStreamMap = await liveCoStreamsByMatch(rawRunning, {
    gameSlug: tournament.game,
    includeEwc: isEwcTournament(tournament),
  });
  const running = rawRunning.map((m) => ({ ...publicMatch(m), coStreams: coStreamMap.get(m.id) }));
  const scheduled = rows.filter((m) => m.status === "scheduled").map(publicMatch);
  const finishedAll = rows.filter((m) => m.status === "finished").map(publicMatch);
  const finished = finishedAll.slice(offset, offset + limit);

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      game: tournament.game,
      source: tournament.source,
      url: tournament.url,
    },
    matches: { running, scheduled, finished },
    total: running.length + scheduled.length + finishedAll.length,
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
