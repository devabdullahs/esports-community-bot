import { all, get, isPostgres, run, transaction } from './client.js';
import { normalizeTeamName } from '../lib/render.js';

export const FOLLOW_ENTITY_TYPES = ['game', 'tournament', 'team', 'player'];

function textOrEmpty(value) {
  const s = String(value ?? '').trim();
  return s;
}

// entity_key semantics per type (see schema comment): game -> slug,
// tournament -> tournaments.id as text, team -> normalizeTeamName(name),
// player -> players.id as text. Callers pass the raw key; team keys are
// normalized here so every writer agrees with the fan-out matcher.
export function normalizeFollowKey(entityType, entityKey) {
  const key = textOrEmpty(entityKey);
  if (entityType === 'team') return normalizeTeamName(key);
  if (entityType === 'game') return key.toLowerCase();
  return key;
}

// Hard per-user quota (ECB-SEC-019): follows are persistent rows fanned out
// on every match transition, so one member must not grow them without bound.
// Re-following an already-followed target stays idempotent at the cap.
export const MAX_FOLLOWS_PER_USER = 200;

export async function upsertFollow({ discordUserId, entityType, entityKey, entityLabel = '', entityRef = '' }) {
  if (!FOLLOW_ENTITY_TYPES.includes(entityType)) throw new Error(`Invalid follow entity type: ${entityType}`);
  const key = normalizeFollowKey(entityType, entityKey);
  if (!discordUserId || !key) throw new Error('upsertFollow requires discordUserId and entityKey.');
  return transaction(async (tx) => {
    if (isPostgres()) {
      await tx.get('SELECT pg_advisory_xact_lock(hashtext($1)) AS locked', [`user-follow:${discordUserId}`]);
    }
    const existing = await tx.get(
      'SELECT 1 AS present FROM user_follows WHERE discord_user_id = $1 AND entity_type = $2 AND entity_key = $3',
      [String(discordUserId), entityType, key],
    );
    if (!existing) {
      const count = await tx.get('SELECT COUNT(*) AS c FROM user_follows WHERE discord_user_id = $1', [
        String(discordUserId),
      ]);
      if (Number(count?.c ?? 0) >= MAX_FOLLOWS_PER_USER) return { limited: true };
    }
    return tx.get(
      `INSERT INTO user_follows (discord_user_id, entity_type, entity_key, entity_label, entity_ref)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (discord_user_id, entity_type, entity_key) DO UPDATE SET
         entity_label = excluded.entity_label,
         entity_ref   = excluded.entity_ref
       RETURNING *`,
      [discordUserId, entityType, key, textOrEmpty(entityLabel), textOrEmpty(entityRef)],
    );
  });
}

export async function deleteFollow({ discordUserId, entityType, entityKey }) {
  const key = normalizeFollowKey(entityType, entityKey);
  const result = await run(
    'DELETE FROM user_follows WHERE discord_user_id = $1 AND entity_type = $2 AND entity_key = $3',
    [discordUserId, entityType, key],
  );
  return result.changes || 0;
}

export async function listFollowsForUser(discordUserId) {
  // Bounded read: the quota keeps live users at <= MAX_FOLLOWS_PER_USER, and
  // the LIMIT protects against legacy rows that predate the cap.
  return all(
    `SELECT * FROM user_follows WHERE discord_user_id = $1
     ORDER BY entity_type ASC, entity_label ASC, entity_key ASC
     LIMIT ${MAX_FOLLOWS_PER_USER + 50}`,
    [discordUserId],
  );
}

export async function getFollow({ discordUserId, entityType, entityKey }) {
  const key = normalizeFollowKey(entityType, entityKey);
  return get(
    'SELECT * FROM user_follows WHERE discord_user_id = $1 AND entity_type = $2 AND entity_key = $3',
    [discordUserId, entityType, key],
  );
}

export async function updateFollowNotificationOverrides({
  discordUserId,
  followId,
  notifyMatchStart,
  notifyMatchResult,
}) {
  const id = Number(followId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid follow id.');
  const updates = [];
  const values = [];
  for (const [column, value] of [
    ['notify_match_start', notifyMatchStart],
    ['notify_match_result', notifyMatchResult],
  ]) {
    if (value === undefined) continue;
    updates.push(`${column} = $${values.length + 1}`);
    values.push(value === null ? null : value ? 1 : 0);
  }
  if (!updates.length) throw new Error('No follow notification overrides to update.');
  values.push(String(discordUserId), id);
  return get(
    `UPDATE user_follows SET ${updates.join(', ')}
     WHERE discord_user_id = $${values.length - 1} AND id = $${values.length}
     RETURNING *`,
    values,
  );
}

// Everyone who should hear about a match event: followers of the tournament's
// game, of the tournament itself, of either team (by normalized name), and of
// any player whose current team is one of the two sides. Player resolution
// happens in JS (normalizeTeamName can't run in SQL) — follower counts are
// single-guild small, so the extra query is cheap.
export async function listFollowersForMatch({ game, tournamentId, teamA, teamB }) {
  const teamKeys = [normalizeTeamName(teamA), normalizeTeamName(teamB)].filter(Boolean);
  const matchGame = textOrEmpty(game).toLowerCase();
  const byUser = new Map();

  function addFollow(row) {
    const follows = byUser.get(row.discord_user_id) || [];
    follows.push(row);
    byUser.set(row.discord_user_id, follows);
  }

  const direct = await all(
    `SELECT * FROM user_follows
     WHERE (entity_type = 'game' AND entity_key = $1)
        OR (entity_type = 'tournament' AND entity_key = $2)
        OR (entity_type = 'team' AND entity_key IN ($3, $4))`,
    [matchGame, String(tournamentId ?? ''), teamKeys[0] || '', teamKeys[1] || teamKeys[0] || ''],
  );
  for (const row of direct) addFollow(row);

  // Join by casting the trusted integer id to TEXT — never the untrusted key to
  // INTEGER, which on Postgres throws on any non-numeric key and would kill the
  // whole fan-out. Game-gated in JS (lenient: only exclude on a definite
  // mismatch) so a Valorant player's followers don't get pinged when a
  // same-named team plays in another game.
  const playerFollows = await all(
    `SELECT f.*, p.current_team_name, p.game
     FROM user_follows f
     JOIN players p ON CAST(p.id AS TEXT) = f.entity_key
     WHERE f.entity_type = 'player' AND p.current_team_name IS NOT NULL`,
    [],
  );
  for (const row of playerFollows) {
    if (!teamKeys.includes(normalizeTeamName(row.current_team_name))) continue;
    const playerGame = textOrEmpty(row.game).toLowerCase();
    if (matchGame && playerGame && playerGame !== matchGame) continue;
    addFollow(row);
  }

  return [...byUser.entries()].map(([discordUserId, follows]) => ({ discordUserId, follows }));
}

// Compatibility projection for existing callers which do not need per-follow
// policy data. The notification fan-out uses listFollowersForMatch above.
export async function listFollowerIdsForMatch(match) {
  return (await listFollowersForMatch(match)).map(({ discordUserId }) => discordUserId);
}

const DEFAULT_PERSONALIZED_LIVE_LIMIT = 5;
const DEFAULT_PERSONALIZED_UPCOMING_LIMIT = 5;
const DEFAULT_PERSONALIZED_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const MAX_PERSONALIZED_MATCH_CANDIDATES = 500;

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function followedMatchProjection(row) {
  return {
    id: Number(row.id),
    tournamentId: Number(row.tournament_id),
    tournamentName: textOrEmpty(row.tournament_name),
    game: textOrEmpty(row.game),
    teamA: textOrEmpty(row.team_a),
    teamB: textOrEmpty(row.team_b),
    status: row.status,
    scheduledAt: row.scheduled_at == null ? null : Number(row.scheduled_at),
  };
}

// This stays a bounded candidate query because team aliases are normalized in JS
// by normalizeTeamName. Keeping that shared matcher avoids a subtly different
// SQL-only normalization path from notification fan-out.
export async function listPersonalizedMatchesForUser(
  discordUserId,
  {
    nowSec,
    liveLimit = DEFAULT_PERSONALIZED_LIVE_LIMIT,
    upcomingLimit = DEFAULT_PERSONALIZED_UPCOMING_LIMIT,
    upcomingWindowSec = DEFAULT_PERSONALIZED_WINDOW_SECONDS,
  } = {},
) {
  const now = Math.trunc(Number(nowSec));
  if (!discordUserId || !Number.isFinite(now)) {
    throw new Error('listPersonalizedMatchesForUser requires discordUserId and nowSec.');
  }
  const safeLiveLimit = boundedPositiveInteger(liveLimit, DEFAULT_PERSONALIZED_LIVE_LIMIT, 20);
  const safeUpcomingLimit = boundedPositiveInteger(upcomingLimit, DEFAULT_PERSONALIZED_UPCOMING_LIMIT, 20);
  const safeWindow = boundedPositiveInteger(upcomingWindowSec, DEFAULT_PERSONALIZED_WINDOW_SECONDS, 14 * 24 * 60 * 60);
  const candidateLimit = Math.min(
    MAX_PERSONALIZED_MATCH_CANDIDATES,
    Math.max(100, (safeLiveLimit + safeUpcomingLimit) * 20),
  );

  const [follows, candidates] = await Promise.all([
    listFollowsForUser(discordUserId),
    all(
      `SELECT m.id, m.tournament_id, m.team_a, m.team_b, m.status, m.scheduled_at,
              t.game, t.name AS tournament_name
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE t.active = 1
         AND t.archived_at IS NULL
         AND (
           (m.status = 'running' AND (m.scheduled_at IS NULL OR m.scheduled_at >= $1 - 43200))
           OR (m.status = 'scheduled' AND m.scheduled_at >= $1 AND m.scheduled_at <= $2)
         )
       ORDER BY CASE m.status WHEN 'running' THEN 0 ELSE 1 END,
                m.scheduled_at ASC,
                m.id ASC
       LIMIT $3`,
      [now, now + safeWindow, candidateLimit],
    ),
  ]);
  if (!follows.length) return { live: [], upcoming: [] };

  const gameKeys = new Set(
    follows.filter((follow) => follow.entity_type === 'game').map((follow) => follow.entity_key),
  );
  const tournamentKeys = new Set(
    follows.filter((follow) => follow.entity_type === 'tournament').map((follow) => follow.entity_key),
  );
  const teamKeys = new Set(
    follows.filter((follow) => follow.entity_type === 'team').map((follow) => follow.entity_key),
  );
  const playerTeams = await all(
    `SELECT p.game, p.current_team_name
     FROM user_follows f
     JOIN players p ON CAST(p.id AS TEXT) = f.entity_key
     WHERE f.discord_user_id = $1
       AND f.entity_type = 'player'
       AND p.current_team_name IS NOT NULL`,
    [discordUserId],
  );

  const matchesFollow = (row) => {
    const matchGame = textOrEmpty(row.game).toLowerCase();
    if (gameKeys.has(matchGame) || tournamentKeys.has(String(row.tournament_id))) return true;

    const matchTeams = [normalizeTeamName(row.team_a), normalizeTeamName(row.team_b)].filter(Boolean);
    if (matchTeams.some((team) => teamKeys.has(team))) return true;

    return playerTeams.some((player) => {
      if (!matchTeams.includes(normalizeTeamName(player.current_team_name))) return false;
      const playerGame = textOrEmpty(player.game).toLowerCase();
      return !matchGame || !playerGame || playerGame === matchGame;
    });
  };

  const seen = new Set();
  const live = [];
  const upcoming = [];
  for (const row of candidates) {
    if (!matchesFollow(row) || seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.status === 'running' && live.length < safeLiveLimit) live.push(followedMatchProjection(row));
    if (row.status === 'scheduled' && upcoming.length < safeUpcomingLimit) upcoming.push(followedMatchProjection(row));
    if (live.length === safeLiveLimit && upcoming.length === safeUpcomingLimit) break;
  }
  return { live, upcoming };
}
