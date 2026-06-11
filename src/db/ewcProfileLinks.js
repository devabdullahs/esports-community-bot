import { db } from './index.js';

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

export function upsertEwcProfileLink({ authUserId, discordUserId, guildId, season = '2026' }) {
  db.prepare(
    `INSERT INTO ewc_profile_links
       (auth_user_id, discord_user_id, guild_id, season, last_sync_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
     ON CONFLICT (discord_user_id) DO UPDATE SET
       auth_user_id = excluded.auth_user_id,
       guild_id = excluded.guild_id,
       season = excluded.season,
       last_sync_error = NULL,
       updated_at = datetime('now')`,
  ).run(authUserId, discordUserId, guildId, season);
  return getEwcProfileLinkByDiscordUser(discordUserId);
}

export function getEwcProfileLinkByDiscordUser(discordUserId) {
  return hydrate(db.prepare('SELECT * FROM ewc_profile_links WHERE discord_user_id = ?').get(discordUserId));
}

export function getEwcProfileLinkByAuthUser(authUserId) {
  return hydrate(db.prepare('SELECT * FROM ewc_profile_links WHERE auth_user_id = ? ORDER BY updated_at DESC LIMIT 1').get(authUserId));
}

export function listEwcProfileLinks({ guildId = null, season = null } = {}) {
  if (guildId && season) {
    return db
      .prepare('SELECT * FROM ewc_profile_links WHERE guild_id = ? AND season = ? ORDER BY updated_at DESC')
      .all(guildId, season)
      .map(hydrate);
  }
  if (guildId) {
    return db.prepare('SELECT * FROM ewc_profile_links WHERE guild_id = ? ORDER BY updated_at DESC').all(guildId).map(hydrate);
  }
  return db.prepare('SELECT * FROM ewc_profile_links ORDER BY updated_at DESC').all().map(hydrate);
}

export function markEwcProfileLinkSynced(discordUserId) {
  db.prepare(
    `UPDATE ewc_profile_links
     SET last_synced_at = datetime('now'), last_sync_error = NULL, updated_at = datetime('now')
     WHERE discord_user_id = ?`,
  ).run(discordUserId);
}

export function markEwcProfileLinkError(discordUserId, error) {
  db.prepare(
    `UPDATE ewc_profile_links
     SET last_sync_error = ?, updated_at = datetime('now')
     WHERE discord_user_id = ?`,
  ).run(String(error || 'Unknown sync error').slice(0, 500), discordUserId);
}

export function deleteEwcProfileLink(discordUserId) {
  return db.prepare('DELETE FROM ewc_profile_links WHERE discord_user_id = ?').run(discordUserId);
}
