import { randomUUID } from 'node:crypto';

import { all, get, run } from './client.js';

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
       (auth_user_id, discord_user_id, guild_id, season, last_sync_error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NULL, $5, $5)
     ON CONFLICT (discord_user_id) DO UPDATE SET
       auth_user_id = excluded.auth_user_id,
       guild_id = excluded.guild_id,
       season = excluded.season,
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

export async function setEwcProfileLinkPublicIdentity({ authUserId, discordUserId, displayName, avatarUrl }) {
  const enabled = Boolean(displayName);
  const now = nowText();
  const avatarToken = enabled && avatarUrl ? randomUUID() : null;
  const result = await run(
    `UPDATE ewc_profile_links
     SET public_identity_enabled = $1,
         public_display_name = $2,
         public_avatar_url = $3,
         public_avatar_token = $4,
         public_identity_updated_at = $5,
         updated_at = $5
     WHERE auth_user_id = $6 AND discord_user_id = $7`,
    [enabled ? 1 : 0, enabled ? displayName : null, enabled ? avatarUrl ?? null : null, avatarToken, now, authUserId, discordUserId],
  );
  const changed = Number(result?.changes ?? result?.rowCount ?? 0);
  return changed ? getEwcProfileLinkByDiscordUser(discordUserId) : null;
}

// Internal-only batch lookup for a leaderboard page. Callers must never pass
// this map through a public serializer: its keys are Discord IDs.
export async function publicEwcProfileIdentitiesByDiscordUserIds(discordUserIds) {
  const ids = [...new Set((Array.isArray(discordUserIds) ? discordUserIds : []).filter((id) => typeof id === 'string' && id))].slice(0, 100);
  if (!ids.length) return new Map();
  const placeholders = ids.map((_id, index) => `$${index + 1}`).join(', ');
  const rows = await all(
    `SELECT discord_user_id, public_display_name, public_avatar_token
     FROM ewc_profile_links
     WHERE public_identity_enabled = 1
       AND public_display_name IS NOT NULL
       AND discord_user_id IN (${placeholders})`,
    ids,
  );
  return new Map(
    rows.map((row) => [
      row.discord_user_id,
      { displayName: String(row.public_display_name || '').slice(0, 80), avatarToken: row.public_avatar_token ? String(row.public_avatar_token) : null },
    ]),
  );
}

export async function getPublicEwcProfileAvatarByToken(token) {
  const row = await get(
    `SELECT public_avatar_url
     FROM ewc_profile_links
     WHERE public_identity_enabled = 1 AND public_avatar_token = $1`,
    [token],
  );
  return row?.public_avatar_url ? String(row.public_avatar_url).slice(0, 2048) : null;
}
