import { all, get, run } from './client.js';

const DEFAULT_PREFS = { dm_enabled: 1, notify_match_start: 1, notify_match_result: 1 };

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function getNotificationPrefs(discordUserId) {
  const row = await get('SELECT * FROM user_notification_prefs WHERE discord_user_id = $1', [discordUserId]);
  return row || { discord_user_id: discordUserId, ...DEFAULT_PREFS, updated_at: null };
}

export async function upsertNotificationPrefs(discordUserId, patch = {}) {
  // The INSERT values fall back to current/default state, but ON CONFLICT only
  // updates the columns actually present in the patch — so two concurrent
  // single-field PATCHes can't clobber each other's field with a stale read.
  const columnPatch = {
    dm_enabled: patch.dmEnabled,
    notify_match_start: patch.notifyMatchStart,
    notify_match_result: patch.notifyMatchResult,
  };
  const current = await getNotificationPrefs(discordUserId);
  const insertValues = {};
  const updates = [];
  for (const [column, value] of Object.entries(columnPatch)) {
    insertValues[column] = value !== undefined ? (value ? 1 : 0) : current[column];
    if (value !== undefined) updates.push(`${column} = excluded.${column}`);
  }
  updates.push('updated_at = excluded.updated_at');
  return get(
    `INSERT INTO user_notification_prefs (discord_user_id, dm_enabled, notify_match_start, notify_match_result, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_user_id) DO UPDATE SET ${updates.join(', ')}
     RETURNING *`,
    [
      discordUserId,
      insertValues.dm_enabled,
      insertValues.notify_match_start,
      insertValues.notify_match_result,
      nowText(),
    ],
  );
}

// Bulk prefs for a follower fan-out. Users without a row get the defaults.
export async function getPrefsForUsers(discordUserIds) {
  const map = new Map();
  for (const id of discordUserIds) map.set(id, { discord_user_id: id, ...DEFAULT_PREFS });
  if (!discordUserIds.length) return map;
  const placeholders = discordUserIds.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await all(
    `SELECT * FROM user_notification_prefs WHERE discord_user_id IN (${placeholders})`,
    discordUserIds,
  );
  for (const row of rows) map.set(row.discord_user_id, row);
  return map;
}

// One notification per user, deduped on (user, dedupe_key) so repeated match
// transitions (score corrections, poll churn) never double-notify. dm_status is
// decided at enqueue time from the user's prefs; the DM drain only ever sees
// rows that were meant to be DMs.
export async function enqueueNotifications({ userIds, type, matchId, title, body = '', url = '', dedupeKey }) {
  if (!dedupeKey) throw new Error('enqueueNotifications requires a dedupeKey.');
  const prefs = await getPrefsForUsers(userIds);
  const prefField = type === 'match_start' ? 'notify_match_start' : 'notify_match_result';
  let inserted = 0;
  for (const userId of userIds) {
    const p = prefs.get(userId);
    if (!p || !p[prefField]) continue;
    const dmStatus = p.dm_enabled ? 'pending' : 'skipped';
    const row = await get(
      `INSERT INTO user_notifications (discord_user_id, type, match_id, title, body, url, dedupe_key, dm_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (discord_user_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [userId, type, matchId ?? null, title, body, url, dedupeKey, dmStatus],
    );
    if (row) inserted += 1;
  }
  return inserted;
}

export async function listNotificationsForUser(discordUserId, { limit = 30, offset = 0 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 30)));
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  return all(
    `SELECT * FROM user_notifications WHERE discord_user_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [discordUserId, safeLimit, safeOffset],
  );
}

export async function listNotificationPageForUser(discordUserId, { limit = 30, offset = 0 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 30)));
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const rows = await all(
    `SELECT * FROM user_notifications WHERE discord_user_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [discordUserId, safeLimit + 1, safeOffset],
  );
  const hasMore = rows.length > safeLimit;
  return {
    notifications: hasMore ? rows.slice(0, safeLimit) : rows,
    nextOffset: hasMore ? safeOffset + safeLimit : null,
  };
}

export async function listUnreadNotificationsForUser(discordUserId, { limit = 3 } = {}) {
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(Number(limit) || 3)));
  return all(
    `SELECT * FROM user_notifications
     WHERE discord_user_id = $1 AND read_at IS NULL
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [discordUserId, safeLimit],
  );
}

export async function countUnreadNotifications(discordUserId) {
  const row = await get(
    'SELECT COUNT(*) AS count FROM user_notifications WHERE discord_user_id = $1 AND read_at IS NULL',
    [discordUserId],
  );
  return Number(row?.count || 0);
}

export async function markNotificationRead(discordUserId, id) {
  const result = await run(
    'UPDATE user_notifications SET read_at = $1 WHERE discord_user_id = $2 AND id = $3 AND read_at IS NULL',
    [nowText(), discordUserId, id],
  );
  return result.changes || 0;
}

export async function markAllNotificationsRead(discordUserId) {
  const result = await run(
    'UPDATE user_notifications SET read_at = $1 WHERE discord_user_id = $2 AND read_at IS NULL',
    [nowText(), discordUserId],
  );
  return result.changes || 0;
}

export async function listPendingDmNotifications(limit = 20) {
  return all(
    `SELECT * FROM user_notifications WHERE dm_status = 'pending' ORDER BY id ASC LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit) || 20))],
  );
}

export async function setDmStatus(id, status) {
  if (!['sent', 'skipped', 'failed'].includes(status)) throw new Error(`Invalid dm_status: ${status}`);
  await run('UPDATE user_notifications SET dm_status = $1 WHERE id = $2', [status, id]);
}
