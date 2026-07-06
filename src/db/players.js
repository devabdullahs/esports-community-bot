import { all, get, run } from './client.js';
import { normalizeTeamName } from '../lib/render.js';
import { EWC_TOURNAMENT_SQL } from './tournamentStandings.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function jsonText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export async function upsertPlayer(row) {
  const pandascoreId = numberOrNull(row?.pandascore_id ?? row?.pandascoreId);
  const name = textOrNull(row?.name);
  if (!pandascoreId) throw new Error('upsertPlayer requires a finite pandascore_id.');
  if (!name) throw new Error('upsertPlayer requires a non-empty name.');

  // Adopt a Liquipedia-only row (slug = normalized nick) so a later PandaScore
  // sync enriches it in place instead of creating a duplicate identity.
  await run(
    `UPDATE players SET pandascore_id = $1
     WHERE pandascore_id IS NULL AND game = $2 AND slug = $3
       AND NOT EXISTS (SELECT 1 FROM players p2 WHERE p2.pandascore_id = $1)`,
    [pandascoreId, textOrNull(row.game), normalizeTeamName(name)],
  );

  const now = nowText();
  return get(
    `INSERT INTO players
       (game, pandascore_id, name, slug, first_name, last_name, nationality, image_url, role,
        current_team_id, current_team_pandascore_id, current_team_name, modified_at, raw_json,
        last_seen_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $15)
     ON CONFLICT (pandascore_id) DO UPDATE SET
       game                       = excluded.game,
       name                       = excluded.name,
       slug                       = COALESCE(excluded.slug, players.slug),
       first_name                 = COALESCE(excluded.first_name, players.first_name),
       last_name                  = COALESCE(excluded.last_name, players.last_name),
       nationality                = COALESCE(excluded.nationality, players.nationality),
       image_url                  = COALESCE(excluded.image_url, players.image_url),
       role                       = COALESCE(excluded.role, players.role),
       current_team_id            = CASE WHEN players.current_team_verified_at IS NOT NULL
                                         THEN players.current_team_id
                                         ELSE COALESCE(excluded.current_team_id, players.current_team_id) END,
       current_team_pandascore_id = CASE WHEN players.current_team_verified_at IS NOT NULL
                                         THEN players.current_team_pandascore_id
                                         ELSE COALESCE(excluded.current_team_pandascore_id, players.current_team_pandascore_id) END,
       current_team_name          = CASE WHEN players.current_team_verified_at IS NOT NULL
                                         THEN players.current_team_name
                                         ELSE COALESCE(excluded.current_team_name, players.current_team_name) END,
       modified_at                = COALESCE(excluded.modified_at, players.modified_at),
       raw_json                   = excluded.raw_json,
       last_seen_at               = excluded.last_seen_at,
       updated_at                 = excluded.updated_at
     RETURNING *`,
    [
      textOrNull(row.game),
      pandascoreId,
      name,
      textOrNull(row.slug),
      textOrNull(row.first_name ?? row.firstName),
      textOrNull(row.last_name ?? row.lastName),
      textOrNull(row.nationality),
      textOrNull(row.image_url ?? row.imageUrl),
      textOrNull(row.role),
      numberOrNull(row.current_team_id ?? row.currentTeamId),
      numberOrNull(row.current_team_pandascore_id ?? row.currentTeamPandaScoreId),
      textOrNull(row.current_team_name ?? row.currentTeamName),
      textOrNull(row.modified_at ?? row.modifiedAt),
      jsonText(row.raw_json ?? row.rawJson),
      now,
    ],
  );
}

export async function getPlayerById(id) {
  return get(
    `SELECT p.*,
            t.id AS resolved_team_id,
            t.name AS resolved_team_name,
            t.slug AS resolved_team_slug,
            t.image_url AS resolved_team_image_url
     FROM players p
     LEFT JOIN teams t ON t.id = p.current_team_id
     WHERE p.id = $1`,
    [id],
  );
}

export async function getPlayerByPandaScoreId(pandascoreId) {
  return get('SELECT * FROM players WHERE pandascore_id = $1', [pandascoreId]);
}

export async function listPlayers({ game = null, q = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (game) {
    params.push(game);
    where.push(`p.game = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(lower(p.name) LIKE $${params.length} OR lower(p.slug) LIKE $${params.length})`);
  }
  const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  params.push(cappedLimit, safeOffset);
  return all(
    `SELECT p.*,
            t.id AS resolved_team_id,
            t.name AS resolved_team_name,
            t.slug AS resolved_team_slug,
            t.image_url AS resolved_team_image_url
     FROM players p
     LEFT JOIN teams t ON t.id = p.current_team_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY lower(p.name) ASC, p.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function countPlayers({ game = null, q = null } = {}) {
  const params = [];
  const where = [];
  if (game) {
    params.push(game);
    where.push(`game = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${params.length} OR lower(slug) LIKE $${params.length})`);
  }
  const row = await get(
    `SELECT COUNT(*) AS count FROM players ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  return Number(row?.count || 0);
}

export async function listPlayersForTeam(teamId) {
  return all(
    `SELECT * FROM players
     WHERE current_team_id = $1
     ORDER BY lower(name) ASC, id ASC`,
    [teamId],
  );
}

// --- Liquipedia enrichment -------------------------------------------------

export async function createLiquipediaPlayer({
  game,
  name,
  slug,
  currentTeamId = null,
  currentTeamName = null,
  liquipediaUrl = null,
}) {
  const now = nowText();
  return get(
    `INSERT INTO players
       (game, pandascore_id, name, slug, current_team_id, current_team_name, liquipedia_url, last_seen_at, created_at, updated_at)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $7, $7)
     RETURNING *`,
    [textOrNull(game), textOrNull(name), textOrNull(slug), currentTeamId, textOrNull(currentTeamName), textOrNull(liquipediaUrl), now],
  );
}

export async function rememberPlayerLiquipediaUrl(id, url) {
  const now = nowText();
  return get(
    `UPDATE players SET
       liquipedia_url = COALESCE(liquipedia_url, $1),
       updated_at     = $2
     WHERE id = $3
     RETURNING *`,
    [textOrNull(url), now, id],
  );
}

// Persist a parsed Liquipedia player page. Bio fields fill gaps only; the
// PandaScore sync keeps ownership of anything it already provides.
export async function savePlayerLiquipedia(
  id,
  { url = null, raw = null, facts = null, image = null, nationality = null, role = null, firstName = null, lastName = null },
) {
  const now = nowText();
  return get(
    `UPDATE players SET
       liquipedia_url       = COALESCE($1, liquipedia_url),
       liquipedia_raw       = $2,
       liquipedia_facts     = $3,
       liquipedia_parsed_at = $4,
       image_url            = COALESCE(image_url, $5),
       nationality          = COALESCE(nationality, $6),
       role                 = COALESCE(role, $7),
       first_name           = COALESCE(first_name, $8),
       last_name            = COALESCE(last_name, $9),
       updated_at           = $4
     WHERE id = $10
     RETURNING *`,
    [
      textOrNull(url), raw, facts ? JSON.stringify(facts) : null, now,
      textOrNull(image), textOrNull(nationality), textOrNull(role), textOrNull(firstName), textOrNull(lastName), id,
    ],
  );
}

// name+page pairs for one game - lets the enrichment job match existing rows
// (PandaScore or previously created) before creating anything.
export async function listPlayerNamesForGame(game) {
  return all(
    'SELECT id, name, image_url, liquipedia_url, liquipedia_parsed_at, current_team_id, current_team_name FROM players WHERE game = $1 ORDER BY id ASC',
    [game],
  );
}

// A successfully parsed Liquipedia roster confirmed this player's team. While
// current_team_verified_at is set, upsertPlayer's PandaScore path leaves the
// current_team_* columns alone — Liquipedia rosters are fresher than
// PandaScore's team data (which can lag transfers by months).
export async function setPlayerVerifiedTeam(id, { teamId, teamName }) {
  const now = nowText();
  return get(
    `UPDATE players SET
       current_team_id            = $1,
       current_team_name          = $2,
       current_team_pandascore_id = NULL,
       current_team_verified_at   = $3,
       updated_at                 = $3
     WHERE id = $4
     RETURNING *`,
    [numberOrNull(teamId), textOrNull(teamName), now, id],
  );
}

// After a roster parse succeeded, players our DB still places on the team but
// who no longer appear on the parsed roster have left. Clearing keeps
// verified_at stamped so a stale PandaScore sync can't put them back.
export async function clearDroppedRosterPlayers(game, teamId, keepIds) {
  const ids = (keepIds ?? []).map(Number).filter(Number.isFinite);
  const now = nowText();
  const params = [game, teamId, now];
  const notIn = ids.map((id) => {
    params.push(id);
    return `$${params.length}`;
  });
  const result = await run(
    `UPDATE players SET
       current_team_id            = NULL,
       current_team_name          = NULL,
       current_team_pandascore_id = NULL,
       current_team_verified_at   = $3,
       updated_at                 = $3
     WHERE game = $1 AND current_team_id = $2
       ${notIn.length ? `AND id NOT IN (${notIn.join(', ')})` : ''}`,
    params,
  );
  return result?.changes ?? 0;
}

// Player photos hosted on Liquipedia - warmed into the shared logo cache so the
// web proxy can serve them (Liquipedia hotlinking is not allowed). PandaScore
// CDN photos are excluded (served directly, not proxied).
export async function listLiquipediaPlayerLogos() {
  const rows = await all(
    `SELECT image_url
       FROM players
      WHERE LOWER(image_url) LIKE 'https://liquipedia.net/%'
      GROUP BY image_url
      ORDER BY MAX(updated_at) DESC, MIN(name) ASC`,
    [],
  );
  return rows.map((row) => row.image_url).filter(Boolean);
}

export async function listPriorityLiquipediaPlayerLogos() {
  const rows = await all(
    `WITH ewc_team_names(name) AS (
       SELECT LOWER(m.team_a) AS name
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.active = 1 AND t.archived_at IS NULL AND ${EWC_TOURNAMENT_SQL}
          AND m.team_a IS NOT NULL AND m.team_a <> ''
       UNION
       SELECT LOWER(m.team_b) AS name
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.active = 1 AND t.archived_at IS NULL AND ${EWC_TOURNAMENT_SQL}
          AND m.team_b IS NOT NULL AND m.team_b <> ''
       UNION
       SELECT LOWER(s.team) AS name
         FROM tournament_standings s
         JOIN tournaments t ON t.id = s.tournament_id
        WHERE t.active = 1 AND t.archived_at IS NULL AND ${EWC_TOURNAMENT_SQL}
          AND s.team IS NOT NULL AND s.team <> ''
     )
     SELECT p.image_url
       FROM players p
       LEFT JOIN teams tm ON tm.id = p.current_team_id
      WHERE LOWER(p.image_url) LIKE 'https://liquipedia.net/%'
        AND (
          LOWER(p.current_team_name) IN (SELECT name FROM ewc_team_names)
          OR LOWER(tm.name) IN (SELECT name FROM ewc_team_names)
          OR LOWER(tm.acronym) IN (SELECT name FROM ewc_team_names)
          OR LOWER(tm.slug) IN (SELECT name FROM ewc_team_names)
        )
      GROUP BY p.image_url
      ORDER BY MAX(p.updated_at) DESC, MIN(p.name) ASC`,
    [],
  );
  return rows.map((row) => row.image_url).filter(Boolean);
}

export async function stampPlayerLiquipedia(id, { url = null } = {}) {
  const now = nowText();
  return get(
    `UPDATE players SET
       liquipedia_url       = COALESCE($1, liquipedia_url),
       liquipedia_parsed_at = $2,
       updated_at           = $2
     WHERE id = $3
     RETURNING *`,
    [textOrNull(url), now, id],
  );
}
