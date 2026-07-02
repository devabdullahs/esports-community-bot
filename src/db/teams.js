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

export async function upsertTeam(row) {
  const pandascoreId = numberOrNull(row?.pandascore_id ?? row?.pandascoreId);
  const name = textOrNull(row?.name);
  if (!pandascoreId) throw new Error('upsertTeam requires a finite pandascore_id.');
  if (!name) throw new Error('upsertTeam requires a non-empty name.');

  const now = nowText();
  return get(
    `INSERT INTO teams
       (game, pandascore_id, name, slug, acronym, nationality, image_url, location, modified_at, raw_json, last_seen_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11)
     ON CONFLICT (pandascore_id) DO UPDATE SET
       game         = excluded.game,
       name         = excluded.name,
       slug         = COALESCE(excluded.slug, teams.slug),
       acronym      = COALESCE(excluded.acronym, teams.acronym),
       nationality  = COALESCE(excluded.nationality, teams.nationality),
       image_url    = COALESCE(excluded.image_url, teams.image_url),
       location     = COALESCE(excluded.location, teams.location),
       modified_at  = COALESCE(excluded.modified_at, teams.modified_at),
       raw_json     = excluded.raw_json,
       last_seen_at = excluded.last_seen_at,
       updated_at   = excluded.updated_at
     RETURNING *`,
    [
      textOrNull(row.game),
      pandascoreId,
      name,
      textOrNull(row.slug),
      textOrNull(row.acronym),
      textOrNull(row.nationality),
      textOrNull(row.image_url ?? row.imageUrl),
      textOrNull(row.location),
      textOrNull(row.modified_at ?? row.modifiedAt),
      jsonText(row.raw_json ?? row.rawJson),
      now,
    ],
  );
}

export async function getTeamById(id) {
  return get('SELECT * FROM teams WHERE id = $1', [id]);
}

export async function getTeamByPandaScoreId(pandascoreId) {
  return get('SELECT * FROM teams WHERE pandascore_id = $1', [pandascoreId]);
}

export async function listTeams({ game = null, q = null, limit = 50, offset = 0 } = {}) {
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
  const cappedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  params.push(cappedLimit, safeOffset);
  return all(
    `SELECT * FROM teams
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY lower(name) ASC, id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function countTeams({ game = null, q = null } = {}) {
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
    `SELECT COUNT(*) AS count FROM teams ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  return Number(row?.count || 0);
}

// id+name pairs for one game - powers the web's match-name -> team-page linking.
export async function listTeamNamesForGame(game) {
  return all('SELECT id, name, liquipedia_parsed_at FROM teams WHERE game = $1 ORDER BY id ASC', [game]);
}

// Distinct games that actually have synced teams - drives the directory's game filter.
export async function listTeamGames() {
  const rows = await all(
    "SELECT DISTINCT game FROM teams WHERE game IS NOT NULL AND game <> '' ORDER BY game ASC",
    [],
  );
  return rows.map((row) => row.game);
}

export async function listTeamPlayers(teamId) {
  return all(
    `SELECT * FROM players
     WHERE current_team_id = $1
     ORDER BY lower(name) ASC, id ASC`,
    [teamId],
  );
}

// --- Liquipedia enrichment -------------------------------------------------

// Minimal row for a Liquipedia-only team (battle royale, TFT, ... - games
// PandaScore doesn't cover). Keyed by (game, slug) via the partial unique
// index; slug is the caller-provided normalized name.
export async function createLiquipediaTeam({ game, name, slug }) {
  const now = nowText();
  return get(
    `INSERT INTO teams (game, pandascore_id, name, slug, last_seen_at, created_at, updated_at)
     VALUES ($1, NULL, $2, $3, $4, $4, $4)
     RETURNING *`,
    [textOrNull(game), textOrNull(name), textOrNull(slug), now],
  );
}

// Persist a parsed Liquipedia page onto a team. Profile fields only fill gaps -
// PandaScore stays the source of truth for current/live fields when present.
export async function saveTeamLiquipedia(id, { url = null, raw = null, facts = null, image = null, location = null }) {
  const now = nowText();
  return get(
    `UPDATE teams SET
       liquipedia_url       = COALESCE($1, liquipedia_url),
       liquipedia_raw       = $2,
       liquipedia_facts     = $3,
       liquipedia_parsed_at = $4,
       image_url            = COALESCE(image_url, $5),
       location             = COALESCE(location, $6),
       updated_at           = $4
     WHERE id = $7
     RETURNING *`,
    [textOrNull(url), raw, facts ? JSON.stringify(facts) : null, now, textOrNull(image), textOrNull(location), id],
  );
}
