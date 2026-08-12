import "server-only";

import { all } from "@bot/db/client.js";
import { dedupeMatches as _dedupeMatches } from "@bot/db/matches.js";
import { listPlayerNamesForGame as _listPlayerNamesForGame } from "@bot/db/players.js";
import { listTeamNamesForGame as _listTeamNamesForGame } from "@bot/db/teams.js";
import {
  listStandingsCounts as _listStandingsCounts,
  listStandingsForTournament as _listStandingsForTournament,
} from "@bot/db/tournamentStandings.js";
import { getTournamentOverview as _getTournamentOverview } from "@bot/db/officialEwcSheets.js";
import { projectTournamentDraw, type TournamentDraw } from "@/lib/tournament-draw";
import {
  getTournamentSyncHealth as _getTournamentSyncHealth,
  listTournamentSyncHealth as _listTournamentSyncHealth,
} from "@bot/db/tournamentSyncHealth.js";
import { publicTournamentSyncHealth as _publicTournamentSyncHealth } from "@bot/lib/tournamentSyncHealth.js";
import { isEwcTournamentReference } from "@bot/lib/ewcTournament.js";
import { isIndividualCompetitorGame as _isIndividualCompetitorGame } from "@bot/lib/games.js";
import { normalizeTeamName as _normalizeTeamName } from "@bot/lib/render.js";
import {
  getTournamentById as _getById,
  listActiveTournaments as _listActive,
  listArchivedTournamentFacets as _listArchivedFacets,
  listArchivedTournaments as _listArchived,
  resolveCanonicalTournamentId as _resolveCanonicalTournamentId,
} from "@bot/db/tournaments.js";
import { unstable_cache } from "next/cache";
import { resolveDefaultGuildId } from "@/lib/guild";
import type { MatchStatus, ResultReason, WinnerSide } from "@/lib/match-lifecycle";
import { liveCoStreamsByMatch, type MatchCoStream } from "@/lib/match-co-streams";
import { ewcPlacementPointsForRank, finalTournamentStandingSection } from "@/lib/tournament-standings";
import { bracketRoundFromStoredMatch } from "@/lib/tournament-brackets";

// ---------------------------------------------------------------------------
// Typed boundary over the bot's tournament/match read helpers (see games.ts).
// Phase 1 is read-only and public. Aggregations (per-status match counts and
// grouped per-tournament matches) are run here as parameterized reads against
// the shared bot DB via the unified async client ($1,$2,... placeholders work
// on both SQLite and Postgres) — the bot exposes no helper for them. We never
// write from the web process.
// ---------------------------------------------------------------------------

export type { MatchStatus } from "@/lib/match-lifecycle";

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

export type MatchCounts = {
  running: number;
  scheduled: number;
  finished: number;
  postponed: number;
  cancelled: number;
};

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

export type ArchivedTournamentFacet = {
  id: number;
  name: string | null;
  game: string | null;
  source: string;
  url: string | null;
  ewc: boolean;
  archived_at: number | null;
  last_match_at: number | null;
  matchCounts: MatchCounts;
};

export type ArchivedTournamentFilters = {
  ewcOnly?: boolean;
  game?: string;
  source?: string;
  query?: string;
  status?: "all" | "live" | "upcoming" | "results";
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
  /** Legacy team ids retained for team-game compatibility. */
  team_a_id?: number | null;
  team_b_id?: number | null;
  team_a_profile_id?: number | null;
  team_b_profile_id?: number | null;
  team_a_profile_type?: "team" | "player" | null;
  team_b_profile_type?: "team" | "player" | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  status: MatchStatus;
  winner_side?: WinnerSide;
  result_reason?: ResultReason;
  /** Public stage label derived from saved match data; never exposes provider IDs. */
  round?: string | null;
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
  profile_id?: number | null;
  profile_type?: "team" | "player" | null;
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
  matches: {
    running: MatchRow[];
    scheduled: MatchRow[];
    finished: MatchRow[];
    postponed: MatchRow[];
    cancelled: MatchRow[];
  };
  bracketMatches?: MatchRow[];
  /** The drawn bracket read off the official workbook; absent when none was persisted. */
  draw?: TournamentDraw;
  standings: StandingRow[];
  overview: TournamentOverview | null;
  totals: MatchCounts & { all: number };
  finishedPage: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  /** Compatibility alias for totals.all. */
  total: number;
};

export type TournamentMatchOptions = {
  limit?: number;
  offset?: number;
  includeBracket?: boolean;
};

export type TournamentOverview = {
  facts: Array<{ label: string; value: string }>;
  sections: Array<{
    title: string;
    columns: string[];
    entries: Array<Record<string, string>>;
  }>;
  attribution: "© Esports Foundation 2026. All rights reserved.";
  updatedAt: string | null;
};

const listActive = _listActive as (guildId?: string) => Promise<TournamentRow[]>;
const listArchived = _listArchived as (
  guildId: string,
  opts?: { limit?: number; offset?: number } & ArchivedTournamentFilters,
) => Promise<TournamentRow[]>;
type ArchivedFacetRow = TournamentRow & {
  running_count: number | string;
  scheduled_count: number | string;
  finished_count: number | string;
  postponed_count: number | string;
  cancelled_count: number | string;
};
const listArchivedFacets = _listArchivedFacets as (
  guildId: string,
) => Promise<ArchivedFacetRow[]>;
const getById = _getById as (id: number) => Promise<TournamentRow | undefined>;
const dedupeMatches = _dedupeMatches as <T extends MatchRow>(rows: T[]) => T[];

function zeroCounts(): MatchCounts {
  return { running: 0, scheduled: 0, finished: 0, postponed: 0, cancelled: 0 };
}

const MATCH_COLUMNS =
  "id, external_id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, winner_side, result_reason, scheduled_at, stream_platform, stream_url, updated_at";

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
   ORDER BY CASE status
              WHEN 'running' THEN 0
              WHEN 'scheduled' THEN 1
              WHEN 'postponed' THEN 2
              WHEN 'finished' THEN 3
              ELSE 4
            END,
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
    winner_side: row.winner_side ?? null,
    result_reason: row.result_reason ?? "unknown",
    round: bracketRoundFromStoredMatch(row),
    scheduled_at: row.scheduled_at,
    updated_at: row.updated_at,
    has_details: matchHasDetails(row.has_details),
    stream: matchStream(row),
  };
}

const listTeamNamesForGame = _listTeamNamesForGame as (
  game: string,
) => Promise<Array<{ id: number; name: string }>>;
const listPlayerNamesForGame = _listPlayerNamesForGame as (
  game: string,
) => Promise<Array<{ id: number; name: string; slug?: string | null }>>;
const listStandingsForTournament = _listStandingsForTournament as (
  tournamentId: number,
) => Promise<StandingRow[]>;
const listStandingsCounts = _listStandingsCounts as () => Promise<
  Array<{ tournament_id: number; count: number }>
>;
const getTournamentSyncHealth = _getTournamentSyncHealth as (tournamentId: number) => Promise<SyncHealthRow | null>;
const getTournamentOverview = _getTournamentOverview as (
  tournamentId: number,
) => Promise<{ payload?: unknown; updatedAt?: string | null } | null>;
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
const isIndividualCompetitorGame = _isIndividualCompetitorGame as (game: string | null | undefined) => boolean;
const livePollIntervalMs = Number(process.env.LIVE_POLL_INTERVAL_MS || 300_000);
const OFFICIAL_ATTRIBUTION = "© Esports Foundation 2026. All rights reserved." as const;
const PUBLIC_OVERVIEW_FACT_KEYS = new Set([
  "format",
  "tournament format",
  "prize pool",
  "platform",
  "game mode",
  "mode",
  "number of teams",
  "total number of teams",
  "number of players",
  "total number of players",
  "number of participants",
  "total number of participants",
  "number of matches",
  "total number of matches",
]);

function overviewRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function overviewText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /https?:\/\/|docs\.google|drive\.google|spreadsheets\/d\//i.test(text)) {
    return null;
  }
  return text;
}

function overviewFactKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function publicTournamentOverview(
  row: { payload?: unknown; updatedAt?: string | null } | null,
): TournamentOverview | null {
  const payload = overviewRecord(row?.payload);
  if (!payload || payload.attribution !== OFFICIAL_ATTRIBUTION) return null;
  const facts = (Array.isArray(payload.facts) ? payload.facts : [])
    .flatMap((item) => {
      const fact = overviewRecord(item);
      const label = overviewText(fact?.label, 80);
      const value = overviewText(fact?.value, 300);
      return label && PUBLIC_OVERVIEW_FACT_KEYS.has(overviewFactKey(label)) && value
        ? [{ label, value }]
        : [];
    })
    .slice(0, PUBLIC_OVERVIEW_FACT_KEYS.size);
  if (!facts.length) return null;
  return {
    facts,
    sections: [],
    attribution: OFFICIAL_ATTRIBUTION,
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : null,
  };
}

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
type ProfileReference = { id: number; type: "team" | "player" };

async function profileResolver(game: string | null): Promise<(name: string | null) => ProfileReference | null> {
  if (!game) return () => null;
  const individual = isIndividualCompetitorGame(game);
  const pairs: Array<{ id: number; name: string; slug?: string | null }> = individual
    ? await listPlayerNamesForGame(game)
    : await listTeamNamesForGame(game);
  const byName = new Map<string, number | null>();
  const registerAlias = (value: string | null | undefined, id: number) => {
    const key = normalizeTeamName(value);
    if (!key) return;
    const existing = byName.get(key);
    if (existing === undefined || existing === id) {
      byName.set(key, id);
      return;
    }
    byName.set(key, null);
  };
  for (const pair of pairs) {
    registerAlias(pair.name, pair.id);
    if (individual) registerAlias(pair.slug, pair.id);
  }
  return (name) => {
    const key = normalizeTeamName(name);
    const id = key ? (byName.get(key) ?? null) : null;
    return id ? { id, type: individual ? "player" : "team" } : null;
  };
}

function withProfileReferences(
  match: MatchRow,
  resolve: (name: string | null) => ProfileReference | null,
): MatchRow {
  const a = resolve(match.team_a);
  const b = resolve(match.team_b);
  return {
    ...match,
    team_a_id: a?.type === "team" ? a.id : null,
    team_b_id: b?.type === "team" ? b.id : null,
    team_a_profile_id: a?.id ?? null,
    team_b_profile_id: b?.id ?? null,
    team_a_profile_type: a?.type ?? null,
    team_b_profile_type: b?.type ?? null,
  };
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
    counts[row.status] += 1;
  }
  return counts;
}

function featuredMatchFromRows(rows: MatchRow[]): MatchRow | null {
  return (
    rows.find((row) => row.status === "running") ??
    rows.find((row) => row.status === "scheduled") ??
    rows.find((row) => row.status === "postponed") ??
    rows.find((row) => row.status === "finished") ??
    rows.find((row) => row.status === "cancelled") ??
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
  game = "",
  source = "",
  query = "",
  status = "all",
}: {
  limit?: number;
  offset?: number;
} & ArchivedTournamentFilters = {}): Promise<TournamentSummary[]> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  const rows = await listArchived(guildId, {
    limit,
    offset,
    ewcOnly,
    game,
    source,
    query,
    status,
  });
  const [withStandings, healthRows] = await Promise.all([
    standingsTournamentIds(),
    listTournamentSyncHealth(rows.map((t) => t.id)),
  ]);
  const healthByTournamentId = new Map(healthRows.map((row) => [row.tournament_id, row]));
  return Promise.all(rows.map((t) => tournamentSummary(t, withStandings, healthByTournamentId)));
}

export async function listArchivedTournamentFacets(): Promise<ArchivedTournamentFacet[]> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  const rows = await listArchivedFacets(guildId);
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name ?? null,
    game: row.game ?? null,
    source: String(row.source),
    url: row.url ?? null,
    ewc: isEwcTournamentReference(row),
    archived_at: row.archived_at == null ? null : Number(row.archived_at),
    last_match_at: row.last_match_at == null ? null : Number(row.last_match_at),
    matchCounts: {
      running: Number(row.running_count || 0),
      scheduled: Number(row.scheduled_count || 0),
      finished: Number(row.finished_count || 0),
      postponed: Number(row.postponed_count || 0),
      cancelled: Number(row.cancelled_count || 0),
    },
  }));
}

/**
 * Matches for one tournament grouped by status. Pagination (limit/offset)
 * applies only to the finished list; running + scheduled are returned in full.
 * Returns null when the tournament is missing or belongs to another guild.
 */
/**
 * Resolves a requested ID to the canonical public tournament, or null.
 *
 * This runs BEFORE any persistent cache: `unstable_cache` mints an entry per distinct
 * argument tuple, so admitting a nonexistent ID afterwards means every anonymous miss has
 * already created a cache namespace that a later `notFound()` cannot retract. Aliases resolve
 * here too, so two URLs for the same tournament converge on one cache identity.
 */
async function admitPublicTournamentId(id: number): Promise<number | null> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return null;
  const canonicalId = await _resolveCanonicalTournamentId(id);
  const tournament = await getById(canonicalId);
  if (
    !tournament
    || tournament.guild_id !== guildId
    || (tournament.active !== 1 && tournament.archived_at == null)
  ) {
    return null;
  }
  return tournament.id;
}

/** Everything a public tournament read needs, before any visitor-selected shaping. */
type TournamentSnapshot = Omit<TournamentMatches, "matches" | "finishedPage" | "bracketMatches"> & {
  matches: { running: MatchRow[]; scheduled: MatchRow[]; postponed: MatchRow[]; cancelled: MatchRow[] };
  finishedAll: MatchRow[];
};

async function buildTournamentSnapshot(canonicalId: number): Promise<TournamentSnapshot | null> {
  const tournament = await getById(canonicalId);
  if (!tournament) return null;

  const rows = await dedupedTournamentMatches(tournament);
  const [resolveProfile, rawStandings, health, rawOverview] = await Promise.all([
    profileResolver(tournament.game),
    listStandingsForTournament(tournament.id),
    getTournamentSyncHealth(tournament.id),
    getTournamentOverview(tournament.id),
  ]);
  let standings = rawStandings.map((row) => {
    const profile = resolveProfile(row.team);
    return {
      ...row,
      team_id: profile?.type === "team" ? profile.id : null,
      profile_id: profile?.id ?? null,
      profile_type: profile?.type ?? null,
    };
  });
  const rawRunning = rows.filter((m) => m.status === "running");
  const coStreamMap = await liveCoStreamsByMatch(rawRunning, {
    gameSlug: tournament.game,
    includeEwc: isEwcTournamentReference(tournament),
  });
  const running = rawRunning.map((m) => ({
    ...withProfileReferences(publicMatch(m), resolveProfile),
    coStreams: coStreamMap.get(m.id),
  }));
  const scheduled = rows
    .filter((m) => m.status === "scheduled")
    .map((m) => withProfileReferences(publicMatch(m), resolveProfile));
  const finishedAll = rows
    .filter((m) => m.status === "finished")
    .map((m) => withProfileReferences(publicMatch(m), resolveProfile));
  const postponed = rows
    .filter((m) => m.status === "postponed")
    .map((m) => withProfileReferences(publicMatch(m), resolveProfile));
  const cancelled = rows
    .filter((m) => m.status === "cancelled")
    .map((m) => withProfileReferences(publicMatch(m), resolveProfile));
  const ewc = isEwcTournamentReference(tournament);
  const standingsHaveResults = rawStandings.some(
    (row) => /[1-9]/.test(String(row.points ?? "")) || /[1-9]/.test(String(row.extra ?? "")),
  );
  const completed = tournament.archived_at != null || (
    running.length === 0
    && scheduled.length === 0
    && postponed.length === 0
    && (finishedAll.length > 0 || standingsHaveResults)
  );
  const totals = {
    running: running.length,
    scheduled: scheduled.length,
    finished: finishedAll.length,
    postponed: postponed.length,
    cancelled: cancelled.length,
    all: running.length + scheduled.length + finishedAll.length + postponed.length + cancelled.length,
  };
  const finalStandingsSection = ewc && completed ? finalTournamentStandingSection(rawStandings) : null;
  if (finalStandingsSection) {
    standings = standings.map((row) => ({
      ...row,
      ...(row.section === finalStandingsSection ? { ewc_points: ewcPlacementPointsForRank(row.rank) } : {}),
    }));
  }

  // Always, not only under includeBracket: the match list polls this endpoint and re-renders
  // the bracket from whatever comes back, so omitting the draw on a refetch made the whole
  // bracket vanish a minute after the page opened. It is derived from rows already in hand.
  const drawnBracket = projectTournamentDraw(
    rawOverview,
    [...running, ...scheduled, ...postponed, ...finishedAll, ...cancelled],
    { normalizeName: normalizeTeamName },
  );

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
    matches: { running, scheduled, postponed, cancelled },
    finishedAll,
    // The workbook's own draw, which unlike a round label survives ingest with its feeder
    // edges intact. Read off the overview row already fetched above, so no extra query.
    ...(drawnBracket ? { draw: drawnBracket } : {}),
    standings,
    overview: publicTournamentOverview(rawOverview),
    totals,
    total: totals.all,
  };
}

/**
 * Applies the visitor's page and bracket request to an already-cached snapshot.
 *
 * Pagination and options are deliberately NOT cache arguments: they are unbounded per
 * request and would mint a near-duplicate persistent payload each time, while the snapshot
 * they slice is identical.
 */
function shapeTournamentMatches(
  snapshot: TournamentSnapshot,
  options: TournamentMatchOptions = {},
): TournamentMatches {
  const requestedLimit = Number.isFinite(options.limit) ? Math.trunc(options.limit as number) : 50;
  const requestedOffset = Number.isFinite(options.offset) ? Math.trunc(options.offset as number) : 0;
  const limit = Math.min(200, Math.max(1, requestedLimit));
  const offset = Math.min(100_000, Math.max(0, requestedOffset));
  const { finishedAll, matches, ...rest } = snapshot;
  const finished = finishedAll.slice(offset, offset + limit);
  const everyMatch = [
    ...matches.running,
    ...matches.scheduled,
    ...matches.postponed,
    ...finishedAll,
    ...matches.cancelled,
  ];

  return {
    ...rest,
    matches: {
      running: matches.running,
      scheduled: matches.scheduled,
      finished,
      postponed: matches.postponed,
      cancelled: matches.cancelled,
    },
    ...(options.includeBracket ? { bracketMatches: everyMatch } : {}),
    finishedPage: {
      offset,
      limit,
      hasMore: offset + finished.length < finishedAll.length,
    },
  };
}

/**
 * Matches for one tournament grouped by status. Pagination (limit/offset)
 * applies only to the finished list; running + scheduled are returned in full.
 * Returns null when the tournament is missing or belongs to another guild.
 */
export async function getTournamentMatches(
  id: number,
  options: TournamentMatchOptions = {},
): Promise<TournamentMatches | null> {
  const canonicalId = await admitPublicTournamentId(id);
  if (canonicalId == null) return null;
  const snapshot = await buildTournamentSnapshot(canonicalId);
  return snapshot ? shapeTournamentMatches(snapshot, options) : null;
}

// ---------------------------------------------------------------------------
// Cached public-read variants.
// Live data → short revalidate so scores refresh within a few seconds even
// without an admin tag invalidation. Tag `cms-tournaments` lets future admin
// writes bust it.
// ---------------------------------------------------------------------------

export const listTournamentSummariesCached = unstable_cache(
  async () => listTournamentSummaries(),
  ["tournaments-list"],
  { tags: ["cms-tournaments"], revalidate: 60 },
);

// PRIVATE. Keyed by canonical tournament ID alone — a closed, existing-object namespace.
// Options and pagination are applied to the returned snapshot instead of being folded into
// the key, so alias URLs and every result page share one entry.
const cachedTournamentSnapshot = unstable_cache(
  async (canonicalId: number) => buildTournamentSnapshot(canonicalId),
  ["tournament-snapshot"],
  { tags: ["cms-tournaments"], revalidate: 10 },
);

export async function getTournamentMatchesCached(
  id: number,
  opts?: TournamentMatchOptions,
): Promise<TournamentMatches | null> {
  const canonicalId = await admitPublicTournamentId(id);
  if (canonicalId == null) return null;
  const snapshot = await cachedTournamentSnapshot(canonicalId);
  return snapshot ? shapeTournamentMatches(snapshot, opts) : null;
}
