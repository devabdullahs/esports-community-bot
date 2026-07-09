import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { all, get, run } from './client.js';

export const MCP_TOOL_NAMES = [
  'get_site_overview',
  'list_games',
  'search_news',
  'get_tournament_status',
  'list_tournaments',
  'get_ewc_club_summary',
  'list_co_streams',
  'search_teams',
  'search_players',
  'get_public_ewc_leaderboard',
  'list_admin_queue',
  'create_news_draft',
  'update_stream_channel',
];

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeArray(values, allowed = null) {
  const allow = allowed ? new Set(allowed) : null;
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v && (!allow || allow.has(v))),
    ),
  ].sort();
}

/**
 * @typedef {object} StoredMcpKey
 * @property {number} id
 * @property {string} keyHash
 * @property {string} keyPrefix
 * @property {string} label
 * @property {string} ownerDiscordId
 * @property {string|null} ownerName
 * @property {string[]} tools
 * @property {string[]} games
 * @property {string[]} media
 * @property {number|null} expiresAt
 * @property {string|null} revokedAt
 * @property {string|null} lastUsedAt
 * @property {string|null} createdBy
 * @property {string} createdAt
 *
 * @typedef {Omit<StoredMcpKey, 'keyHash'>} SafeMcpKey
 */

/**
 * @param {Record<string, any>|null|undefined} row
 * @returns {StoredMcpKey|null}
 */
function hydrateStoredKey(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    label: row.label || '',
    ownerDiscordId: row.owner_discord_id,
    ownerName: row.owner_name || null,
    tools: parseJsonArray(row.tools_json),
    games: parseJsonArray(row.game_scopes_json),
    media: parseJsonArray(row.media_scopes_json),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

/**
 * @param {StoredMcpKey|null} stored
 * @returns {SafeMcpKey|null}
 */
function safeKeyMetadata(stored) {
  if (!stored) return null;
  return {
    id: stored.id,
    keyPrefix: stored.keyPrefix,
    label: stored.label,
    ownerDiscordId: stored.ownerDiscordId,
    ownerName: stored.ownerName,
    tools: stored.tools,
    games: stored.games,
    media: stored.media,
    expiresAt: stored.expiresAt,
    revokedAt: stored.revokedAt,
    lastUsedAt: stored.lastUsedAt,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
  };
}

export function generateMcpKeySecret() {
  return `ec_mcp_live_${randomBytes(32).toString('base64url')}`;
}

export function hashMcpKeySecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

export function mcpKeyPrefix(secret) {
  return String(secret).slice(0, 18);
}

export function timingSafeHashEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createMcpKey({
  label = '',
  ownerDiscordId,
  ownerName = null,
  tools = MCP_TOOL_NAMES,
  games = [],
  media = [],
  expiresAt = null,
  createdBy = null,
} = {}) {
  const secret = generateMcpKeySecret();
  const keyHash = hashMcpKeySecret(secret);
  const normalizedTools = normalizeArray(tools, MCP_TOOL_NAMES);
  const row = await get(
    `INSERT INTO ewc_mcp_keys
       (key_hash, key_prefix, label, owner_discord_id, owner_name, tools_json, game_scopes_json, media_scopes_json, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      keyHash,
      mcpKeyPrefix(secret),
      String(label || '').trim().slice(0, 100),
      String(ownerDiscordId || '').trim(),
      ownerName ? String(ownerName).trim().slice(0, 100) : null,
      JSON.stringify(normalizedTools.length ? normalizedTools : MCP_TOOL_NAMES),
      JSON.stringify(normalizeArray(games)),
      JSON.stringify(normalizeArray(media)),
      expiresAt == null ? null : Math.floor(Number(expiresAt) || 0),
      createdBy || null,
    ],
  );
  return { key: safeKeyMetadata(hydrateStoredKey(row)), secret };
}

export async function listMcpKeys() {
  const rows = await all(
    `SELECT * FROM ewc_mcp_keys
     ORDER BY revoked_at IS NOT NULL ASC, created_at DESC, id DESC`,
  );
  return rows.map(hydrateStoredKey).map(safeKeyMetadata);
}

export async function getMcpKey(id) {
  return safeKeyMetadata(hydrateStoredKey(await get('SELECT * FROM ewc_mcp_keys WHERE id = $1', [id])));
}

async function getMcpKeyByHash(hash) {
  return hydrateStoredKey(await get('SELECT * FROM ewc_mcp_keys WHERE key_hash = $1', [hash]));
}

export async function verifyMcpKeySecret(secret, nowSec = Math.floor(Date.now() / 1000)) {
  const hash = hashMcpKeySecret(secret);
  const stored = await getMcpKeyByHash(hash);
  if (!stored || !timingSafeHashEqual(stored.keyHash, hash)) return null;
  if (stored.revokedAt) return null;
  if (stored.expiresAt != null && stored.expiresAt <= nowSec) return null;
  return safeKeyMetadata(stored);
}

export async function touchMcpKey(id) {
  await run('UPDATE ewc_mcp_keys SET last_used_at = $1 WHERE id = $2', [nowText(), id]);
}

export async function revokeMcpKey(id) {
  const result = await run(
    `UPDATE ewc_mcp_keys
     SET revoked_at = COALESCE(revoked_at, $1)
     WHERE id = $2`,
    [nowText(), id],
  );
  return { revoked: result.changes || result.rowCount || 0 };
}
