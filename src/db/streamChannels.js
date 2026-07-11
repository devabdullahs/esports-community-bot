import { all, get, run, transaction } from './client.js';
import { normalizeGameSlug } from '../lib/games.js';
import { normalizeTeamName } from '../lib/render.js';

// Admin-curated live-stream / co-stream channels. A channel is attached at one
// SCOPE: 'game' (every match of a game), 'team' (every match a team plays),
// 'match' (one match by external id), or 'ewc' (the official EWC co-stream list).
// Live status (is_live, title, viewers) is tracked separately by the poller/webhook
// layer — this module is just the registry.

const PLATFORMS = new Set(['twitch', 'kick', 'youtube', 'soop']);
const SCOPES = new Set(['game', 'team', 'match', 'ewc']);

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Blank (never null) so the NOT NULL DEFAULT '' scope-key columns and the UNIQUE
// constraint behave identically across SQLite and Postgres.
function blank(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeCreatorKey(value) {
  return blank(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function cleanGameSlug(value) {
  const raw = blank(value).toLowerCase();
  if (!raw) return '';
  return normalizeGameSlug(raw.replace(/[^a-z0-9]+/g, ''));
}

export function parseGameSlugs(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/[,،;|/\s]+/u)
        .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const slug = cleanGameSlug(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out.slice(0, 12);
}

function gameSlugsJson(slugs) {
  return JSON.stringify(parseGameSlugs(slugs));
}

// Accept a full channel URL, an @handle, or a bare handle and return the canonical
// handle. Twitch/Kick handles are case-insensitive → lowercased; YouTube/SOOP kept
// as given (minus a leading @). Exported so the admin layer can normalize input.
export function parseChannelHandle(platform, input) {
  let s = String(input ?? '').trim();
  if (!s) return '';
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?[^/]+\/(.+)$/i);
  if (url) s = url[1];
  s = s.split(/[/?#]/)[0].replace(/^@/, '').trim();
  return platform === 'twitch' || platform === 'kick' ? s.toLowerCase() : s;
}

// Public watch URL for a channel (also used as the embed source base).
export function channelUrl(platform, handle) {
  switch (platform) {
    case 'twitch':
      return `https://www.twitch.tv/${handle}`;
    case 'kick':
      return `https://kick.com/${handle}`;
    case 'youtube':
      return `https://www.youtube.com/${/^@/.test(handle) ? handle : `@${handle}`}`;
    case 'soop':
      return `https://www.sooplive.com/${handle}`;
    default:
      return null;
  }
}

function hydrate(row) {
  if (!row) return null;
  let gameSlugs = parseGameSlugs(parseJson(row.game_slugs, row.game_slug ? [row.game_slug] : []));
  if (!gameSlugs.length && row.game_slug) gameSlugs = parseGameSlugs([row.game_slug]);
  const label = row.label || row.handle;
  const creatorKey = row.creator_key || normalizeCreatorKey(label || row.handle);
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    label,
    scope: row.scope,
    creatorKey,
    gameSlug: row.game_slug || gameSlugs[0] || null,
    gameSlugs,
    teamKey: row.team_key || null,
    matchExternalId: row.match_external_id || null,
    language: row.language || null,
    sortOrder: row.sort_order,
    isDefault: Boolean(row.is_default),
    active: Boolean(row.active),
    addedBy: row.added_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: channelUrl(row.platform, row.handle),
  };
}

async function nextSortOrder(scope, client = { get }) {
  const row = await client.get('SELECT MAX(sort_order) AS m FROM stream_channels WHERE scope = $1', [scope]);
  return (row?.m == null ? -1 : row.m) + 1;
}

// Create (or re-activate) a channel. Re-adding the same channel at the same scope
// target upserts label/language and flips it back to active.
export async function createStreamChannel({
  platform,
  handle,
  label = '',
  scope,
  gameSlug = '',
  gameSlugs = null,
  creatorKey = '',
  team = '',
  matchExternalId = '',
  language = '',
  isDefault = false,
  addedBy = null,
}) {
  if (!PLATFORMS.has(platform)) throw new Error(`Unknown platform: ${platform}`);
  if (!SCOPES.has(scope)) throw new Error(`Unknown scope: ${scope}`);
  const cleanHandle = parseChannelHandle(platform, handle);
  if (!cleanHandle) throw new Error('A channel handle is required.');

  // game_slug doubles as an optional filter tag on any scope; team_key/match id
  // are only meaningful on their own scope.
  const games = parseGameSlugs(gameSlugs ?? gameSlug);
  const gameKey = games[0] || '';
  const gamesJson = gameSlugsJson(games);
  const cleanLabel = blank(label);
  const cleanCreatorKey = normalizeCreatorKey(creatorKey || cleanLabel || cleanHandle);
  const teamKey = scope === 'team' ? normalizeTeamName(team) : '';
  const matchKey = scope === 'match' ? blank(matchExternalId) : '';
  if (scope === 'game' && !gameKey) throw new Error('A game-scope channel needs a game.');
  if (scope === 'team' && !teamKey) throw new Error('A team-scope channel needs a team.');
  if (scope === 'match' && !matchKey) throw new Error('A match-scope channel needs a match external id.');

  const now = nowText();
  const row = await get(
    `INSERT INTO stream_channels
       (platform, handle, label, scope, creator_key, game_slug, game_slugs, team_key,
        match_external_id, language, sort_order, is_default, active, added_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14, $14)
     ON CONFLICT (platform, handle, scope, game_slug, team_key, match_external_id) DO UPDATE SET
       label = excluded.label,
       creator_key = excluded.creator_key,
       game_slugs = excluded.game_slugs,
       language = excluded.language,
       is_default = excluded.is_default,
       active = 1,
       updated_at = excluded.updated_at
     RETURNING *`,
    [
      platform,
      cleanHandle,
      cleanLabel,
      scope,
      cleanCreatorKey,
      gameKey,
      gamesJson,
      teamKey,
      matchKey,
      blank(language),
      await nextSortOrder(scope),
      isDefault ? 1 : 0,
      addedBy,
      now,
    ],
  );
  if (row?.is_default && cleanCreatorKey) {
    await run('UPDATE stream_channels SET is_default = 0 WHERE creator_key = $1 AND id <> $2', [cleanCreatorKey, row.id]);
  }
  return getStreamChannel(row.id);
}

export async function getStreamChannelInTx(client, id) {
  return hydrate(await client.get('SELECT * FROM stream_channels WHERE id = $1', [id]));
}

export async function getStreamChannel(id) {
  return getStreamChannelInTx({ get }, id);
}

async function allowedSiblingIds(client, { creatorKey, scope = null, excludedId, gameSlugs }) {
  const params = [creatorKey, excludedId];
  const where = ['creator_key = $1', 'id <> $2'];
  if (scope) {
    params.push(scope);
    where.push(`scope = $${params.length}`);
  }
  const rows = await client.all(`SELECT * FROM stream_channels WHERE ${where.join(' AND ')}`, params);
  if (gameSlugs === undefined) return rows.map((row) => row.id);

  const allowed = new Set(parseGameSlugs(gameSlugs));
  if (!allowed.size) return [];
  return rows
    .map(hydrate)
    .filter((channel) => (
      channel?.scope === 'game' &&
      channel.gameSlugs.length > 0 &&
      channel.gameSlugs.every((slug) => allowed.has(slug))
    ))
    .map((channel) => channel.id);
}

// Admin listing, optionally filtered by scope / game / active-only.
export async function listStreamChannels({ scope = null, gameSlug = null, activeOnly = false } = {}) {
  const where = [];
  const params = [];
  if (scope) {
    params.push(scope);
    where.push(`scope = $${params.length}`);
  }
  if (gameSlug) {
    const slug = cleanGameSlug(gameSlug);
    params.push(slug);
    const single = `$${params.length}`;
    params.push(`%"${slug}"%`);
    where.push(`(game_slug = ${single} OR game_slugs LIKE $${params.length})`);
  }
  if (activeOnly) where.push('active = 1');
  const sql = `SELECT * FROM stream_channels ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY sort_order ASC, id ASC`;
  return (await all(sql, params)).map(hydrate);
}

// The official EWC co-stream list.
export async function listEwcStreamChannels({ activeOnly = false } = {}) {
  return listStreamChannels({ scope: 'ewc', activeOnly });
}

// Every channel applicable to a single match: its game's channels, either team's
// channels, channels pinned to this match, and (optionally) the EWC list. Deduped
// by platform+handle, keeping the first (scope/sort) hit.
export async function channelsForMatch({
  gameSlug = null,
  teamA = null,
  teamB = null,
  matchExternalId = null,
  includeEwc = false,
} = {}) {
  const teams = [teamA, teamB].map(normalizeTeamName).filter(Boolean);

  const params = [];
  const ors = [];
  const matchGameSlug = cleanGameSlug(gameSlug);
  params.push(matchGameSlug);
  const gameParam = `$${params.length}`;
  params.push(`%"${matchGameSlug}"%`);
  ors.push(`(scope = 'game' AND (game_slug = ${gameParam} OR game_slugs LIKE $${params.length}))`);
  params.push(blank(matchExternalId));
  ors.push(`(scope = 'match' AND match_external_id = $${params.length})`);
  if (teams.length) {
    const placeholders = teams.map((t) => {
      params.push(t);
      return `$${params.length}`;
    });
    ors.push(`(scope = 'team' AND team_key IN (${placeholders.join(',')}))`);
  }
  if (includeEwc) ors.push(`(scope = 'ewc')`);

  const rows = await all(
    `SELECT * FROM stream_channels WHERE active = 1 AND (${ors.join(' OR ')})
     ORDER BY sort_order ASC, id ASC`,
    params,
  );

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.platform}:${row.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hydrate(row));
  }
  return out;
}

// Every channel applicable to a whole tournament's live matches in ONE query —
// the union of its game's channels, any of the listed teams' channels, channels
// pinned to any of the listed match ids, and (optionally) the EWC list. The web
// layer fans these back out per match. Distinct $n placeholders only (Postgres
// rejects placeholder reuse). Returns hydrated rows (not deduped — callers map
// per match by platform+handle).
export async function channelsForTournament({ gameSlug = null, teams = [], matchExternalIds = [], includeEwc = false } = {}) {
  const teamKeys = [...new Set(teams.map(normalizeTeamName).filter(Boolean))];
  const matchIds = [...new Set(matchExternalIds.map((v) => String(v ?? '').trim()).filter(Boolean))];
  const params = [];
  const ors = [];
  const gs = cleanGameSlug(gameSlug);
  if (gs) {
    params.push(gs);
    const single = `$${params.length}`;
    params.push(`%"${gs}"%`);
    ors.push(`(scope = 'game' AND (game_slug = ${single} OR game_slugs LIKE $${params.length}))`);
  }
  if (includeEwc) ors.push(`(scope = 'ewc')`);
  if (teamKeys.length) {
    const ph = teamKeys.map((t) => { params.push(t); return `$${params.length}`; });
    ors.push(`(scope = 'team' AND team_key IN (${ph.join(',')}))`);
  }
  if (matchIds.length) {
    const ph = matchIds.map((m) => { params.push(m); return `$${params.length}`; });
    ors.push(`(scope = 'match' AND match_external_id IN (${ph.join(',')}))`);
  }
  if (!ors.length) return [];
  const rows = await all(`SELECT * FROM stream_channels WHERE active = 1 AND (${ors.join(' OR ')}) ORDER BY sort_order ASC, id ASC`, params);
  return rows.map(hydrate);
}

export async function updateStreamChannelInTx(client, id, {
  label,
  language,
  sortOrder,
  active,
  gameSlugs,
  isDefault,
  creatorKey,
  propagateToGameSlugs,
} = {}) {
  const sets = [];
  const params = [];
  const push = (col, value) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (label !== undefined) push('label', blank(label));
  if (creatorKey !== undefined) push('creator_key', normalizeCreatorKey(creatorKey));
  if (language !== undefined) push('language', blank(language));
  if (sortOrder !== undefined) push('sort_order', Number(sortOrder) || 0);
  if (active !== undefined) push('active', active ? 1 : 0);
  if (gameSlugs !== undefined) {
    const games = parseGameSlugs(gameSlugs);
    push('game_slug', games[0] || '');
    push('game_slugs', gameSlugsJson(games));
  }
  if (isDefault !== undefined) push('is_default', isDefault ? 1 : 0);
  if (!sets.length) return getStreamChannelInTx(client, id);
  push('updated_at', nowText());
  params.push(id);
  const info = await client.run(`UPDATE stream_channels SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!info.changes) return null;
  const updated = await getStreamChannelInTx(client, id);

  // label/language/game tags describe the creator, not the individual platform —
  // propagate ONLY those columns to siblings sharing creator_key + scope. Never
  // touch is_default/active/sort_order (those stay per-row). Push every value with
  // a distinct placeholder — reusing a $n across clauses crashes Postgres.
  if (updated?.creatorKey && (label !== undefined || language !== undefined || gameSlugs !== undefined)) {
    const siblingIds = await allowedSiblingIds(client, {
      creatorKey: updated.creatorKey,
      scope: updated.scope,
      excludedId: id,
      gameSlugs: propagateToGameSlugs,
    });
    const sib = [];
    const sp = [];
    const spush = (col, value) => {
      sp.push(value);
      sib.push(`${col} = $${sp.length}`);
    };
    if (label !== undefined) spush('label', blank(label));
    if (language !== undefined) spush('language', blank(language));
    if (gameSlugs !== undefined) {
      const games = parseGameSlugs(gameSlugs);
      spush('game_slug', games[0] || '');
      spush('game_slugs', gameSlugsJson(games));
    }
    spush('updated_at', nowText());
    if (siblingIds.length) {
      const placeholders = siblingIds.map((siblingId) => {
        sp.push(siblingId);
        return `$${sp.length}`;
      });
      await client.run(`UPDATE stream_channels SET ${sib.join(', ')} WHERE id IN (${placeholders.join(',')})`, sp);
    }
  }

  if (updated?.isDefault && updated.creatorKey) {
    const defaultSiblingIds = await allowedSiblingIds(client, {
      creatorKey: updated.creatorKey,
      excludedId: id,
      gameSlugs: propagateToGameSlugs,
    });
    if (defaultSiblingIds.length) {
      const params = defaultSiblingIds;
      const placeholders = params.map((_siblingId, index) => `$${index + 1}`);
      await client.run(`UPDATE stream_channels SET is_default = 0 WHERE id IN (${placeholders.join(',')})`, params);
    }
  }
  return getStreamChannelInTx(client, id);
}

export async function updateStreamChannel(id, patch = {}) {
  return transaction((client) => updateStreamChannelInTx(client, id, patch));
}

export async function repairDuplicateStreamDefaults() {
  return transaction(async (client) => {
    const rows = await client.all(
      `SELECT id, creator_key, label, handle, scope, is_default
       FROM stream_channels
       ORDER BY sort_order, id`,
    );
    const seen = new Set();
    const duplicateIds = [];
    for (const row of rows) {
      const creatorKey = normalizeCreatorKey(row.creator_key || row.label || row.handle);
      if (!creatorKey) continue;
      if (row.creator_key !== creatorKey) {
        await client.run('UPDATE stream_channels SET creator_key = $1 WHERE id = $2', [creatorKey, row.id]);
      }
      if (!row.is_default) continue;
      const key = `${creatorKey}|${row.scope}`;
      if (seen.has(key)) duplicateIds.push(row.id);
      else seen.add(key);
    }
    if (!duplicateIds.length) return 0;
    const placeholders = duplicateIds.map((_id, index) => `$${index + 1}`);
    const result = await client.run(
      `UPDATE stream_channels SET is_default = 0 WHERE id IN (${placeholders.join(',')})`,
      duplicateIds,
    );
    return result.changes || result.rowCount || 0;
  });
}

export async function setStreamChannelActive(id, active) {
  return updateStreamChannel(id, { active });
}

export async function deleteStreamChannel(id) {
  const info = await run('DELETE FROM stream_channels WHERE id = $1', [id]);
  return { deleted: info.changes || 0 };
}

// Distinct handles per platform — the input the live-status poller/webhook layer
// needs to batch its API calls.
// Display metadata for one platform+handle (the go-live announcement needs the
// creator's label). Prefers the default/lowest-sorted active row.
export async function getActiveChannelMeta(platform, handle) {
  const row = await get(
    `SELECT id, platform, handle, label, scope, creator_key, language, sort_order, is_default
       FROM stream_channels
      WHERE platform = $1 AND LOWER(handle) = LOWER($2) AND active = 1
      ORDER BY is_default DESC, sort_order ASC, id ASC
      LIMIT 1`,
    [platform, handle],
  );
  if (!row) return null;
  const label = row.label || row.handle;
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    label,
    scope: row.scope,
    creatorKey: row.creator_key || normalizeCreatorKey(label || row.handle),
    language: row.language || null,
    sortOrder: row.sort_order == null ? 0 : Number(row.sort_order),
    isDefault: Boolean(row.is_default),
  };
}

export async function listDistinctActiveHandles() {
  const rows = await all(
    `SELECT DISTINCT platform, handle FROM stream_channels WHERE active = 1 ORDER BY platform, handle`,
  );
  return rows.map((r) => ({ platform: r.platform, handle: r.handle }));
}
