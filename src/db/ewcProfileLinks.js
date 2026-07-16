import { randomUUID } from 'node:crypto';

import { all, get, run } from './client.js';

const PUBLIC_PREDICTOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hydrate(row) {
  if (!row) return null;
  return {
    authUserId: row.auth_user_id,
    discordUserId: row.discord_user_id,
    guildId: row.guild_id,
    season: row.season,
    publicIdentityEnabled: Boolean(row.public_identity_enabled),
    publicDisplayName: row.public_display_name || null,
    publicAvatarUrl: row.public_avatar_url || null,
    publicAvatarToken: row.public_avatar_token || null,
    publicIdentityUpdatedAt: row.public_identity_updated_at || null,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function upsertEwcProfileLink({ authUserId, discordUserId, guildId, season = '2026' }) {
  const now = nowText();
  await run(
    `INSERT INTO ewc_profile_links
       (auth_user_id, discord_user_id, guild_id, season, public_identity_enabled, last_sync_error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, NULL, $5, $5)
     ON CONFLICT (discord_user_id) DO UPDATE SET
       auth_user_id = excluded.auth_user_id,
       guild_id = excluded.guild_id,
       season = excluded.season,
       public_identity_enabled = 1,
       last_sync_error = NULL,
       updated_at = excluded.updated_at`,
    [authUserId, discordUserId, guildId, season, now],
  );
  return getEwcProfileLinkByDiscordUser(discordUserId);
}

export async function getEwcProfileLinkByDiscordUser(discordUserId) {
  return hydrate(await get('SELECT * FROM ewc_profile_links WHERE discord_user_id = $1', [discordUserId]));
}

export async function getEwcProfileLinkByAuthUser(authUserId) {
  return hydrate(
    await get('SELECT * FROM ewc_profile_links WHERE auth_user_id = $1 ORDER BY updated_at DESC LIMIT 1', [authUserId]),
  );
}

export async function listEwcProfileLinks({ guildId = null, season = null } = {}) {
  if (guildId && season) {
    return (await all('SELECT * FROM ewc_profile_links WHERE guild_id = $1 AND season = $2 ORDER BY updated_at DESC', [guildId, season])).map(hydrate);
  }
  if (guildId) {
    return (await all('SELECT * FROM ewc_profile_links WHERE guild_id = $1 ORDER BY updated_at DESC', [guildId])).map(hydrate);
  }
  return (await all('SELECT * FROM ewc_profile_links ORDER BY updated_at DESC')).map(hydrate);
}

export async function markEwcProfileLinkSynced(discordUserId) {
  const now = nowText();
  await run(
    `UPDATE ewc_profile_links
     SET last_synced_at = $1,
         last_sync_error = NULL,
         updated_at = $1
     WHERE discord_user_id = $2`,
    [now, discordUserId],
  );
}

export async function markEwcProfileLinkError(discordUserId, error) {
  const now = nowText();
  await run(
    `UPDATE ewc_profile_links
     SET last_sync_error = $1,
         updated_at = $2
     WHERE discord_user_id = $3`,
    [String(error || 'Unknown sync error').slice(0, 500), now, discordUserId],
  );
}

export async function deleteEwcProfileLink(discordUserId) {
  return run('DELETE FROM ewc_profile_links WHERE discord_user_id = $1', [discordUserId]);
}

function publicDisplayName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || null;
}

function publicDiscordAvatarUrl(value) {
  const raw = String(value ?? '');
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname.toLowerCase())
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function fallbackPublicDisplayName(discordUserId) {
  return `Member ${String(discordUserId).slice(-4)}`;
}

export function isPublicEwcPredictorId(value) {
  return typeof value === 'string' && PUBLIC_PREDICTOR_ID_PATTERN.test(value);
}

export async function upsertPublicEwcPredictorIdentity({ discordUserId, displayName, avatarUrl = null }) {
  const safeName = publicDisplayName(displayName);
  if (!discordUserId || !safeName) return null;
  const safeAvatar = publicDiscordAvatarUrl(avatarUrl);
  const existing = await get(
    'SELECT avatar_token FROM ewc_public_predictor_identities WHERE discord_user_id = $1',
    [discordUserId],
  );
  // This opaque UUID is also the stable public predictor route id. Keep it
  // when an avatar is removed so old profile links do not break.
  const avatarToken = String(existing?.avatar_token || randomUUID());
  const now = nowText();
  await run(
    `INSERT INTO ewc_public_predictor_identities
       (discord_user_id, display_name, avatar_url, avatar_token, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_user_id) DO UPDATE SET
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       avatar_token = excluded.avatar_token,
       updated_at = excluded.updated_at`,
    [discordUserId, safeName, safeAvatar, avatarToken, now],
  );
  return { displayName: safeName, avatarToken, hasAvatar: Boolean(safeAvatar) };
}

// Internal lookup only: callers use the returned Discord id to build a
// separately projected public response and must not serialize it directly.
export async function getEwcPredictorDiscordUserIdByPublicId(publicId) {
  if (!isPublicEwcPredictorId(publicId)) return null;
  const row = await get(
    `SELECT discord_user_id
     FROM (
       SELECT discord_user_id, 1 AS priority
       FROM ewc_profile_links
       WHERE public_avatar_token = $1
       UNION ALL
       SELECT discord_user_id, 2 AS priority
       FROM ewc_public_predictor_identities
       WHERE avatar_token = $2
     ) identities
     ORDER BY priority
     LIMIT 1`,
    [publicId, publicId],
  );
  return typeof row?.discord_user_id === 'string' ? row.discord_user_id : null;
}

// Internal-only batch lookup for a leaderboard page. Callers must never pass
// this map through a public serializer: its keys are Discord IDs.
export async function publicEwcProfileIdentitiesByDiscordUserIds(discordUserIds) {
  const ids = [...new Set((Array.isArray(discordUserIds) ? discordUserIds : []).filter((id) => typeof id === 'string' && id))].slice(0, 100);
  if (!ids.length) return new Map();
  const placeholders = ids.map((_id, index) => `$${index + 1}`).join(', ');
  const publicRows = await all(
    `SELECT discord_user_id, display_name, avatar_url, avatar_token
     FROM ewc_public_predictor_identities
     WHERE discord_user_id IN (${placeholders})`,
    ids,
  );
  let rows;
  try {
    rows = await all(
      `SELECT l.discord_user_id, l.public_identity_enabled, l.public_display_name,
              l.public_avatar_url, l.public_avatar_token,
              u.name AS auth_display_name, u.image AS auth_avatar_url
       FROM ewc_profile_links l
       LEFT JOIN "user" u ON u.id = l.auth_user_id
       WHERE l.discord_user_id IN (${placeholders})`,
      ids,
    );
  } catch (error) {
    if (!/(?:no such table|relation .* does not exist).*user/i.test(String(error?.message || error))) throw error;
    rows = await all(
      `SELECT discord_user_id, public_identity_enabled, public_display_name,
              public_avatar_url, public_avatar_token,
              NULL AS auth_display_name, NULL AS auth_avatar_url
       FROM ewc_profile_links
       WHERE discord_user_id IN (${placeholders})`,
      ids,
    );
  }

  const identities = new Map(
    publicRows.map((row) => [
      row.discord_user_id,
      {
        displayName: publicDisplayName(row.display_name),
        avatarToken: row.avatar_token ? String(row.avatar_token) : null,
        hasAvatar: Boolean(publicDiscordAvatarUrl(row.avatar_url)),
      },
    ]),
  );
  const publicRowsByDiscordUserId = new Map(publicRows.map((row) => [row.discord_user_id, row]));
  for (const row of rows) {
    const displayName = publicDisplayName(row.auth_display_name) || publicDisplayName(row.public_display_name);
    if (!displayName) continue;
    const avatarUrl = publicDiscordAvatarUrl(row.auth_avatar_url) || publicDiscordAvatarUrl(row.public_avatar_url);
    const avatarToken = String(row.public_avatar_token || randomUUID());
    if (!row.public_identity_enabled || row.public_display_name !== displayName || row.public_avatar_url !== avatarUrl || row.public_avatar_token !== avatarToken) {
      const now = nowText();
      await run(
        `UPDATE ewc_profile_links
         SET public_identity_enabled = 1,
             public_display_name = $1,
             public_avatar_url = $2,
             public_avatar_token = $3,
             public_identity_updated_at = $4,
             updated_at = $4
         WHERE discord_user_id = $5`,
        [displayName, avatarUrl, avatarToken, now, row.discord_user_id],
      );
    }
    identities.set(row.discord_user_id, { displayName, avatarToken, hasAvatar: Boolean(avatarUrl) });
  }
  for (const discordUserId of ids) {
    const existing = identities.get(discordUserId);
    if (existing?.avatarToken) continue;
    const publicRow = publicRowsByDiscordUserId.get(discordUserId);
    const identity = await upsertPublicEwcPredictorIdentity({
      discordUserId,
      displayName: existing?.displayName || fallbackPublicDisplayName(discordUserId),
      avatarUrl: publicRow?.avatar_url || null,
    });
    if (identity) identities.set(discordUserId, identity);
  }
  return identities;
}

export async function getPublicEwcProfileAvatarByToken(token) {
  const row = await get(
    `SELECT avatar_url
     FROM (
       SELECT public_avatar_url AS avatar_url, 1 AS priority
       FROM ewc_profile_links
       WHERE public_avatar_token = $1
       UNION ALL
       SELECT avatar_url, 2 AS priority
       FROM ewc_public_predictor_identities
       WHERE avatar_token = $2
     ) identities
     ORDER BY priority
     LIMIT 1`,
    [token, token],
  );
  return row?.avatar_url ? String(row.avatar_url).slice(0, 2048) : null;
}
