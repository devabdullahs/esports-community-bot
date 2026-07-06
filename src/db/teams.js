import { all, get, run } from './client.js';
import { normalizeTeamName } from '../lib/render.js';

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

  // Adopt a Liquipedia-only row (created by the enrichment job before PandaScore
  // knew this team) instead of inserting a near-duplicate: claim it by setting
  // pandascore_id, then the ON CONFLICT upsert below lands on that same row.
  // Liquipedia rows use slug = normalizeTeamName(name), which is how they meet.
  await run(
    `UPDATE teams SET pandascore_id = $1
     WHERE pandascore_id IS NULL AND game = $2 AND slug = $3
       AND NOT EXISTS (SELECT 1 FROM teams t2 WHERE t2.pandascore_id = $1)`,
    [pandascoreId, textOrNull(row.game), normalizeTeamName(name)],
  );

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
  return all(
    'SELECT id, pandascore_id, name, liquipedia_url, liquipedia_raw, liquipedia_parsed_at FROM teams WHERE game = $1 ORDER BY id ASC',
    [game],
  );
}

// game -> most recent liquipedia_parsed_at across its teams (NULL when a game
// was never enriched). Drives the enrichment job's least-recently-enriched-first
// game ordering, so the budget always goes to the most starved game instead of
// depending on shuffle luck.
export async function listGameLastEnrichedAt() {
  return all(
    `SELECT game, MAX(liquipedia_parsed_at) AS last_parsed_at
       FROM teams
      WHERE game IS NOT NULL
      GROUP BY game`,
    [],
  );
}

// Remove team rows by id. The enrichment job uses this to retire junk rows it
// created from BR schedule names ("Grand Finals - Game 3") before the
// schedule-row filter existed — callers must pre-filter to Liquipedia-created
// stubs (NULL pandascore_id, no parsed data). players.current_team_id declares
// ON DELETE SET NULL, so a stray reference detaches instead of blocking.
export async function deleteTeamsByIds(ids) {
  let deleted = 0;
  for (const id of ids ?? []) {
    const result = await run('DELETE FROM teams WHERE id = $1', [id]);
    deleted += Number(result?.changes ?? 0);
  }
  return deleted;
}

// Team crests hosted on Liquipedia - the logo-warmup job pre-downloads these
// into the shared cache so the web logo proxy can serve them (Liquipedia
// hotlinking is not allowed). PandaScore CDN crests are excluded: those may be
// served directly and are not cacheable through the Liquipedia-only proxy.
export async function listLiquipediaTeamLogos() {
  const rows = await all(
    "SELECT DISTINCT image_url FROM teams WHERE LOWER(image_url) LIKE 'https://liquipedia.net/%'",
    [],
  );
  return rows.map((row) => row.image_url).filter(Boolean);
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

// Freshness stamp for a resolution MISS: only parsed_at (+url when known) moves,
// so a previously enriched row never loses its raw/facts to a failed refresh.
export async function stampTeamLiquipedia(id, { url = null } = {}) {
  const now = nowText();
  return get(
    `UPDATE teams SET
       liquipedia_url       = COALESCE($1, liquipedia_url),
       liquipedia_parsed_at = $2,
       updated_at           = $2
     WHERE id = $3
     RETURNING *`,
    [textOrNull(url), now, id],
  );
}
