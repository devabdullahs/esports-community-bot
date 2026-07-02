import { all, get, run } from './client.js';
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

export async function upsertFollow({ discordUserId, entityType, entityKey, entityLabel = '', entityRef = '' }) {
  if (!FOLLOW_ENTITY_TYPES.includes(entityType)) throw new Error(`Invalid follow entity type: ${entityType}`);
  const key = normalizeFollowKey(entityType, entityKey);
  if (!discordUserId || !key) throw new Error('upsertFollow requires discordUserId and entityKey.');
  return get(
    `INSERT INTO user_follows (discord_user_id, entity_type, entity_key, entity_label, entity_ref)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_user_id, entity_type, entity_key) DO UPDATE SET
       entity_label = excluded.entity_label,
       entity_ref   = excluded.entity_ref
     RETURNING *`,
    [discordUserId, entityType, key, textOrEmpty(entityLabel), textOrEmpty(entityRef)],
  );
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
  return all(
    'SELECT * FROM user_follows WHERE discord_user_id = $1 ORDER BY entity_type ASC, entity_label ASC, entity_key ASC',
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

// Everyone who should hear about a match event: followers of the tournament's
// game, of the tournament itself, of either team (by normalized name), and of
// any player whose current team is one of the two sides. Player resolution
// happens in JS (normalizeTeamName can't run in SQL) — follower counts are
// single-guild small, so the extra query is cheap.
export async function listFollowerIdsForMatch({ game, tournamentId, teamA, teamB }) {
  const teamKeys = [normalizeTeamName(teamA), normalizeTeamName(teamB)].filter(Boolean);
  const ids = new Set();

  const direct = await all(
    `SELECT DISTINCT discord_user_id, entity_type, entity_key FROM user_follows
     WHERE (entity_type = 'game' AND entity_key = $1)
        OR (entity_type = 'tournament' AND entity_key = $2)
        OR (entity_type = 'team' AND entity_key IN ($3, $4))`,
    [textOrEmpty(game), String(tournamentId ?? ''), teamKeys[0] || '', teamKeys[1] || teamKeys[0] || ''],
  );
  for (const row of direct) ids.add(row.discord_user_id);

  const playerFollows = await all(
    `SELECT f.discord_user_id, p.current_team_name
     FROM user_follows f
     JOIN players p ON p.id = CAST(f.entity_key AS INTEGER)
     WHERE f.entity_type = 'player' AND p.current_team_name IS NOT NULL`,
    [],
  );
  for (const row of playerFollows) {
    if (teamKeys.includes(normalizeTeamName(row.current_team_name))) ids.add(row.discord_user_id);
  }

  return [...ids];
}
