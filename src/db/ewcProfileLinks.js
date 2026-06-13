import { all, get, run } from './client.js';

function hydrate(row) {
  if (!row) return null;
  return {
    authUserId: row.auth_user_id,
    discordUserId: row.discord_user_id,
    guildId: row.guild_id,
    season: row.season,
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
