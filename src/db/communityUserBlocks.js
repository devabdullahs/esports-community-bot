import { all, get, run } from './client.js';

function hydrate(row) {
  if (!row) return null;
  return {
    discordUserId: row.discord_user_id,
    blockedBy: row.blocked_by,
    blockedByName: row.blocked_by_name,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function blockUser({ discordUserId, blockedBy, blockedByName = null, reason = null }) {
  const now = nowText();
  await run(
    `INSERT INTO community_user_blocks
       (discord_user_id, blocked_by, blocked_by_name, reason, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_user_id) DO UPDATE SET
       blocked_by = excluded.blocked_by,
       blocked_by_name = excluded.blocked_by_name,
       reason = excluded.reason,
       created_at = excluded.created_at`,
    [discordUserId, blockedBy, blockedByName, reason, now],
  );
  return getBlock(discordUserId);
}

export async function unblockUser(discordUserId) {
  const result = await run('DELETE FROM community_user_blocks WHERE discord_user_id = $1', [discordUserId]);
  return { removed: result.changes || 0 };
}

export async function isUserBlocked(discordUserId) {
  const row = await get('SELECT 1 AS hit FROM community_user_blocks WHERE discord_user_id = $1', [discordUserId]);
  return Boolean(row);
}

export async function getBlock(discordUserId) {
  return hydrate(await get('SELECT * FROM community_user_blocks WHERE discord_user_id = $1', [discordUserId]));
}

export async function listBlockedUsers() {
  return (await all('SELECT * FROM community_user_blocks ORDER BY created_at DESC')).map(hydrate);
}
