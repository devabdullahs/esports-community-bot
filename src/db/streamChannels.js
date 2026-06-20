import { all, get, run } from './client.js';
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
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    label: row.label || row.handle,
    scope: row.scope,
    gameSlug: row.game_slug || null,
    teamKey: row.team_key || null,
    matchExternalId: row.match_external_id || null,
    language: row.language || null,
    sortOrder: row.sort_order,
    active: Boolean(row.active),
    addedBy: row.added_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: channelUrl(row.platform, row.handle),
  };
}

async function nextSortOrder(scope) {
  const row = await get('SELECT MAX(sort_order) AS m FROM stream_channels WHERE scope = $1', [scope]);
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
  team = '',
  matchExternalId = '',
  language = '',
  addedBy = null,
}) {
  if (!PLATFORMS.has(platform)) throw new Error(`Unknown platform: ${platform}`);
  if (!SCOPES.has(scope)) throw new Error(`Unknown scope: ${scope}`);
  const cleanHandle = parseChannelHandle(platform, handle);
  if (!cleanHandle) throw new Error('A channel handle is required.');

  // game_slug doubles as an optional filter tag on any scope; team_key/match id
  // are only meaningful on their own scope.
  const gameKey = blank(gameSlug);
  const teamKey = scope === 'team' ? normalizeTeamName(team) : '';
  const matchKey = scope === 'match' ? blank(matchExternalId) : '';
  if (scope === 'game' && !gameKey) throw new Error('A game-scope channel needs a game.');
  if (scope === 'team' && !teamKey) throw new Error('A team-scope channel needs a team.');
  if (scope === 'match' && !matchKey) throw new Error('A match-scope channel needs a match external id.');

  const now = nowText();
  const row = await get(
    `INSERT INTO stream_channels
       (platform, handle, label, scope, game_slug, team_key, match_external_id, language,
        sort_order, active, added_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $11)
     ON CONFLICT (platform, handle, scope, game_slug, team_key, match_external_id) DO UPDATE SET
       label = excluded.label,
       language = excluded.language,
       active = 1,
       updated_at = excluded.updated_at
     RETURNING *`,
    [platform, cleanHandle, blank(label), scope, gameKey, teamKey, matchKey, blank(language), await nextSortOrder(scope), addedBy, now],
  );
  return hydrate(row);
}

export async function getStreamChannel(id) {
  return hydrate(await get('SELECT * FROM stream_channels WHERE id = $1', [id]));
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
    params.push(gameSlug);
    where.push(`game_slug = $${params.length}`);
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
  params.push(blank(gameSlug));
  ors.push(`(scope = 'game' AND game_slug = $${params.length})`);
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

export async function updateStreamChannel(id, { label, language, sortOrder, active } = {}) {
  const sets = [];
  const params = [];
  const push = (col, value) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (label !== undefined) push('label', blank(label));
  if (language !== undefined) push('language', blank(language));
  if (sortOrder !== undefined) push('sort_order', Number(sortOrder) || 0);
  if (active !== undefined) push('active', active ? 1 : 0);
  if (!sets.length) return getStreamChannel(id);
  push('updated_at', nowText());
  params.push(id);
  const info = await run(`UPDATE stream_channels SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!info.changes) return null;
  return getStreamChannel(id);
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
export async function listDistinctActiveHandles() {
  const rows = await all(
    `SELECT DISTINCT platform, handle FROM stream_channels WHERE active = 1 ORDER BY platform, handle`,
  );
  return rows.map((r) => ({ platform: r.platform, handle: r.handle }));
}
