import "server-only";

import { all } from "@bot/db/client.js";
import { dedupeMatches as _dedupeMatches } from "@bot/db/matches.js";
import { listTeamNamesForGame as _listTeamNamesForGame } from "@bot/db/teams.js";
import {
  listStandingsCounts as _listStandingsCounts,
  listStandingsForTournament as _listStandingsForTournament,
} from "@bot/db/tournamentStandings.js";
import {
  getTournamentSyncHealth as _getTournamentSyncHealth,
  listTournamentSyncHealth as _listTournamentSyncHealth,
} from "@bot/db/tournamentSyncHealth.js";
import { publicTournamentSyncHealth as _publicTournamentSyncHealth } from "@bot/lib/tournamentSyncHealth.js";
import { isEwcTournamentReference } from "@bot/lib/ewcTournament.js";
import { normalizeTeamName as _normalizeTeamName } from "@bot/lib/render.js";
import {
  getTournamentById as _getById,
  listActiveTournaments as _listActive,
  listArchivedTournaments as _listArchived,
  resolveCanonicalTournamentId as _resolveCanonicalTournamentId,
} from "@bot/db/tournaments.js";
import { unstable_cache } from "next/cache";
import { resolveDefaultGuildId } from "@/lib/guild";
import { liveCoStreamsByMatch, type MatchCoStream } from "@/lib/match-co-streams";
import { ewcPlacementPointsForRank, finalTournamentStandingSection } from "@/lib/tournament-standings";

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
  ewc?: number | null;
  active: number;
  archived_at: number | null;
  created_at: string;
  last_match_at?: number | null;
};

export type MatchCounts = { running: number; scheduled: number; finished: number };

export type PublicSyncHealth = {
  state: "fresh" | "delayed" | "unavailable" | "final";
  lastSuccessAt: number | null;
  source: "liquipedia" | "startgg" | "pandascore";
};

type SyncHealthRow = {
  tournament_id: number;
  source: string;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_category: string | null;
  consecutive_failures: number;
  last_item_count: number | null;
  updated_at: number;
};

export type TournamentSummary = {
  id: number;
  name: string | null;
  game: string | null;
  source: string;
  url: string | null;
  active: number;
  archived_at?: number | null;
  last_match_at?: number | null;
  created_at: string;
  ewc: boolean;
  matchCounts: MatchCounts;
  syncHealth: PublicSyncHealth;
  /** Standings-format events (battle royale, TFT groups) have rows here instead of matches. */
  hasStandings: boolean;
  featuredMatch: MatchRow | null;
};

export type MatchStream = { platform: string; url: string };

export function matchHasDetails(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export type MatchRow = {
  id: number;
  external_id?: string;
  game?: string | null;
  name: string | null;
  team_a: string | null;
  team_b: string | null;
  /** PandaScore team-profile ids, linked only on an unambiguous name match. */
  team_a_id?: number | null;
  team_b_id?: number | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  status: MatchStatus;
  scheduled_at: number | null;
  updated_at: string | null;
  has_details?: boolean;
  // Raw columns (present on DB reads, omitted from the public projection).
  stream_platform?: string | null;
  stream_url?: string | null;
  // Official per-match broadcast stream (derived watch link), public projection.
  stream?: MatchStream | null;
  coStreams?: MatchCoStream[];
};

export type StandingRow = {
  id: number;
  tournament_id: number;
  section: string;
  rank: number;
  team: string;
  team_id?: number | null;
  logo: string | null;
  points: string;
  extra: string;
  section_order?: number;
  ewc_points?: number;
  updated_at: string;
};

export type TournamentMatches = {
  tournament: {
    id: number;
    name: string | null;
    game: string | null;
    source: string;
    url: string | null;
    ewc: boolean;
    completed: boolean;
    final_standings_section: string | null;
    syncHealth: PublicSyncHealth;
  };
  matches: { running: MatchRow[]; scheduled: MatchRow[]; finished: MatchRow[] };
  standings: StandingRow[];
  total: number;
};

const listActive = _listActive as (guildId?: string) => Promise<TournamentRow[]>;
const listArchived = _listArchived as (
  guildId: string,
  opts?: { limit?: number; offset?: number },
) => Promise<TournamentRow[]>;
const getById = _getById as (id: number) => Promise<TournamentRow | undefined>;
const dedupeMatches = _dedupeMatches as <T extends MatchRow>(rows: T[]) => T[];

function zeroCounts(): MatchCounts {
  return { running: 0, scheduled: 0, finished: 0 };
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
const MATCHES_SQL = `SELECT ${MATCH_COLUMNS},
       EXISTS(SELECT 1 FROM match_details md WHERE md.match_id = matches.id) AS has_details
   FROM matches
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
    has_details: matchHasDetails(row.has_details),
    stream: matchStream(row),
  };
}

const listTeamNamesForGame = _listTeamNamesForGame as (
  game: string,
) => Promise<Array<{ id: number; name: string }>>;
const listStandingsForTournament = _listStandingsForTournament as (
  tournamentId: number,
) => Promise<StandingRow[]>;
const listStandingsCounts = _listStandingsCounts as () => Promise<
  Array<{ tournament_id: number; count: number }>
>;
const getTournamentSyncHealth = _getTournamentSyncHealth as (tournamentId: number) => Promise<SyncHealthRow | null>;
const listTournamentSyncHealth = _listTournamentSyncHealth as (tournamentIds: number[]) => Promise<SyncHealthRow[]>;
const publicTournamentSyncHealth = _publicTournamentSyncHealth as (
  health: SyncHealthRow | null | undefined,
  options: {
    source: string;
    archivedAt?: number | null;
    hasRunningMatch?: boolean;
    pollIntervalMs: number;
  },
) => PublicSyncHealth;
const normalizeTeamName = _normalizeTeamName as (value: string | null | undefined) => string;
const livePollIntervalMs = Number(process.env.LIVE_POLL_INTERVAL_MS || 300_000);

function syncHealthForTournament(
  tournament: TournamentRow,
  health: SyncHealthRow | null | undefined,
  hasRunningMatch: boolean,
): PublicSyncHealth {
  return publicTournamentSyncHealth(health, {
    source: tournament.source,
    archivedAt: tournament.archived_at,
    hasRunningMatch,
    pollIntervalMs: livePollIntervalMs,
  });
}

// Map a tournament's synced team names -> profile ids for linking. Only
// unambiguous matches link: two teams sharing a normalized name map to null
// rather than guessing. Matches store Liquipedia/start.gg names while profiles
// store PandaScore names, so normalization is what makes them meet.
async function teamIdResolver(game: string | null): Promise<(name: string | null) => number | null> {
  if (!game) return () => null;
  const pairs = await listTeamNamesForGame(game);
  const byName = new Map<string, number | null>();
  for (const pair of pairs) {
    const key = normalizeTeamName(pair.name);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : pair.id);
  }
  return (name) => {
    const key = normalizeTeamName(name);
    return key ? (byName.get(key) ?? null) : null;
  };
}

function withTeamIds(match: MatchRow, resolve: (name: string | null) => number | null): MatchRow {
  return { ...match, team_a_id: resolve(match.team_a), team_b_id: resolve(match.team_b) };
}

async function dedupedTournamentMatches(tournament: TournamentRow): Promise<MatchRow[]> {
  const rows = ((await all(MATCHES_SQL, [tournament.id])) as Array<MatchRow & { has_details?: unknown }>).map((row) => ({
    ...row,
    has_details: matchHasDetails(row.has_details),
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

function featuredMatchFromRows(rows: MatchRow[]): MatchRow | null {
  return (
    rows.find((row) => row.status === "running") ??
    rows.find((row) => row.status === "scheduled") ??
    rows.find((row) => row.status === "finished") ??
    null
  );
}

async function standingsTournamentIds(): Promise<Set<number>> {
  const counts = await listStandingsCounts();
  return new Set(counts.filter((c) => c.count > 0).map((c) => c.tournament_id));
}

async function tournamentSummary(
  t: TournamentRow,
  withStandings: Set<number>,
  healthByTournamentId: Map<number, SyncHealthRow>,
): Promise<TournamentSummary> {
  const rows = await dedupedTournamentMatches(t);
  const featuredMatch = featuredMatchFromRows(rows);
  return {
    id: t.id,
    name: t.name,
    game: t.game,
    source: t.source,
    url: t.url,
    active: t.active,
    archived_at: t.archived_at,
    last_match_at: t.last_match_at,
    created_at: t.created_at,
    ewc: isEwcTournamentReference(t),
    matchCounts: countsFromRows(rows),
    syncHealth: syncHealthForTournament(t, healthByTournamentId.get(t.id), rows.some((row) => row.status === "running")),
    hasStandings: withStandings.has(t.id),
    featuredMatch: featuredMatch ? publicMatch(featuredMatch) : null,
  };
}

/** Active tournaments for the configured guild, each with per-status match counts. */
export async function listTournamentSummaries(): Promise<TournamentSummary[]> {
  // The bot only renders match cards for active tournaments (getMatchesForGuild
  // joins on t.active = 1), so listActiveTournaments mirrors exactly what Discord
  // shows. The only gap was the guild id, now DB-derived.
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  const tournaments = await listActive(guildId);
  const [withStandings, healthRows] = await Promise.all([
    standingsTournamentIds(),
    listTournamentSyncHealth(tournaments.map((t) => t.id)),
  ]);
  const healthByTournamentId = new Map(healthRows.map((row) => [row.tournament_id, row]));
  return Promise.all(tournaments.map((t) => tournamentSummary(t, withStandings, healthByTournamentId)));
}

/** Archived tournaments for the configured guild, newest finished first. */
export async function listArchivedTournamentSummaries({
  limit = 25,
  offset = 0,
  ewcOnly = false,
}: {
  limit?: number;
  offset?: number;
  ewcOnly?: boolean;
} = {}): Promise<TournamentSummary[]> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  const rows = await listArchived(guildId, { limit, offset });
  const [withStandings, healthRows] = await Promise.all([
    standingsTournamentIds(),
    listTournamentSyncHealth(rows.map((t) => t.id)),
  ]);
  const healthByTournamentId = new Map(healthRows.map((row) => [row.tournament_id, row]));
  const summaries = await Promise.all(rows.map((t) => tournamentSummary(t, withStandings, healthByTournamentId)));
  return ewcOnly ? summaries.filter((t) => t.ewc) : summaries;
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
  const canonicalId = await _resolveCanonicalTournamentId(id);
  const tournament = await getById(canonicalId);
  if (!tournament || tournament.guild_id !== guildId || tournament.active !== 1) return null;

  const rows = await dedupedTournamentMatches(tournament);
  const [resolveTeamId, rawStandings, health] = await Promise.all([
    teamIdResolver(tournament.game),
    listStandingsForTournament(tournament.id),
    getTournamentSyncHealth(tournament.id),
  ]);
  let standings = rawStandings.map((row) => ({
    ...row,
    team_id: resolveTeamId(row.team),
  }));
  const rawRunning = rows.filter((m) => m.status === "running");
  const coStreamMap = await liveCoStreamsByMatch(rawRunning, {
    gameSlug: tournament.game,
    includeEwc: isEwcTournamentReference(tournament),
  });
  const running = rawRunning.map((m) => ({
    ...withTeamIds(publicMatch(m), resolveTeamId),
    coStreams: coStreamMap.get(m.id),
  }));
  const scheduled = rows
    .filter((m) => m.status === "scheduled")
    .map((m) => withTeamIds(publicMatch(m), resolveTeamId));
  const finishedAll = rows
    .filter((m) => m.status === "finished")
    .map((m) => withTeamIds(publicMatch(m), resolveTeamId));
  const finished = finishedAll.slice(offset, offset + limit);
  const ewc = isEwcTournamentReference(tournament);
  const standingsHaveResults = rawStandings.some(
    (row) => /[1-9]/.test(String(row.points ?? "")) || /[1-9]/.test(String(row.extra ?? "")),
  );
  const completed = tournament.archived_at != null || (
    running.length === 0 && scheduled.length === 0 && (finishedAll.length > 0 || standingsHaveResults)
  );
  const finalStandingsSection = ewc && completed ? finalTournamentStandingSection(rawStandings) : null;
  if (finalStandingsSection) {
    standings = standings.map((row) => ({
      ...row,
      ...(row.section === finalStandingsSection ? { ewc_points: ewcPlacementPointsForRank(row.rank) } : {}),
    }));
  }

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      game: tournament.game,
      source: tournament.source,
      url: tournament.url,
      ewc,
      completed,
      final_standings_section: finalStandingsSection,
      syncHealth: syncHealthForTournament(tournament, health, rawRunning.length > 0),
    },
    matches: { running, scheduled, finished },
    standings,
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
