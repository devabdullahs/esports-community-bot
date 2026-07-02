import { all, get } from './client.js';

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
       current_team_id            = COALESCE(excluded.current_team_id, players.current_team_id),
       current_team_pandascore_id = COALESCE(excluded.current_team_pandascore_id, players.current_team_pandascore_id),
       current_team_name          = COALESCE(excluded.current_team_name, players.current_team_name),
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

export async function createLiquipediaPlayer({ game, name, slug, currentTeamId = null, currentTeamName = null }) {
  const now = nowText();
  return get(
    `INSERT INTO players (game, pandascore_id, name, slug, current_team_id, current_team_name, last_seen_at, created_at, updated_at)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $6, $6)
     RETURNING *`,
    [textOrNull(game), textOrNull(name), textOrNull(slug), currentTeamId, textOrNull(currentTeamName), now],
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
  return all('SELECT id, name, liquipedia_parsed_at FROM players WHERE game = $1 ORDER BY id ASC', [game]);
}
