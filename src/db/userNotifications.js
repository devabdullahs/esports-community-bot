import { all, get, run, transaction } from './client.js';
import { dmNotBefore, normalizeNotificationSchedule } from '../lib/notificationSchedule.js';

const DEFAULT_PREFS = {
  dm_enabled: 1,
  notify_match_start: 1,
  notify_match_result: 1,
  dm_delivery_mode: 'instant',
  timezone: 'Asia/Riyadh',
  quiet_start_minute: null,
  quiet_end_minute: null,
  digest_minute: 1080,
};

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
  const columnPatch = [
    ['dm_enabled', patch.dmEnabled, (value) => (value ? 1 : 0)],
    ['notify_match_start', patch.notifyMatchStart, (value) => (value ? 1 : 0)],
    ['notify_match_result', patch.notifyMatchResult, (value) => (value ? 1 : 0)],
    ['dm_delivery_mode', patch.dmDeliveryMode, (value) => (value === 'daily_digest' ? 'daily_digest' : 'instant')],
    ['timezone', patch.timezone, (value) => normalizeNotificationSchedule({ timezone: value }).timezone],
    ['quiet_start_minute', patch.quietStartMinute, (value) => value],
    ['quiet_end_minute', patch.quietEndMinute, (value) => value],
    ['digest_minute', patch.digestMinute, (value) => value],
  ];
  const current = await getNotificationPrefs(discordUserId);
  const insertValues = {};
  const updates = [];
  for (const [column, value, normalize] of columnPatch) {
    insertValues[column] = value !== undefined ? normalize(value) : current[column];
    if (value !== undefined) updates.push(`${column} = excluded.${column}`);
  }
  updates.push('updated_at = excluded.updated_at');
  return get(
    `INSERT INTO user_notification_prefs (
       discord_user_id, dm_enabled, notify_match_start, notify_match_result,
       dm_delivery_mode, timezone, quiet_start_minute, quiet_end_minute, digest_minute, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (discord_user_id) DO UPDATE SET ${updates.join(', ')}
     RETURNING *`,
    [
      discordUserId,
      insertValues.dm_enabled,
      insertValues.notify_match_start,
      insertValues.notify_match_result,
      insertValues.dm_delivery_mode,
      insertValues.timezone,
      insertValues.quiet_start_minute,
      insertValues.quiet_end_minute,
      insertValues.digest_minute,
      nowText(),
    ],
  );
}

export function isEventEnabledForFollows(prefs, follows, type) {
  const globalColumn = type === 'match_start' ? 'notify_match_start' : 'notify_match_result';
  const overrideColumn = globalColumn;
  if (!Array.isArray(follows) || !follows.length) return Boolean(prefs?.[globalColumn]);
  return follows.some((follow) => {
    const override = follow[overrideColumn];
    return override === null || override === undefined
      ? Boolean(prefs?.[globalColumn])
      : Boolean(Number(override));
  });
}

// A one-match reminder deliberately uses the member's global event preference
// rather than a follow-level override. When a member has both, either an
// enabled reminder/default or an enabled follow can admit the same deduped row.
export function isEventEnabledForRecipient(prefs, recipient, type) {
  const globalColumn = type === 'match_start' ? 'notify_match_start' : 'notify_match_result';
  if (recipient?.matchReminder && Boolean(prefs?.[globalColumn])) return true;
  return isEventEnabledForFollows(prefs, recipient?.follows || [], type);
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
export async function enqueueNotifications({
  userIds,
  recipients,
  type,
  matchId,
  title,
  body = '',
  url = '',
  dedupeKey,
  nowSec = Math.floor(Date.now() / 1000),
}) {
  if (!dedupeKey) throw new Error('enqueueNotifications requires a dedupeKey.');
  const byUser = new Map();
  for (const recipient of recipients || []) {
    if (!recipient?.discordUserId) continue;
    const current = byUser.get(recipient.discordUserId) || { follows: [], matchReminder: false };
    current.follows.push(...(recipient.follows || []));
    current.matchReminder ||= Boolean(recipient.matchReminder);
    byUser.set(recipient.discordUserId, current);
  }
  for (const userId of userIds || []) {
    if (!byUser.has(userId)) byUser.set(userId, { follows: [], matchReminder: false });
  }
  const ids = [...byUser.keys()];
  const prefs = await getPrefsForUsers(ids);
  let inserted = 0;
  for (const userId of ids) {
    const p = prefs.get(userId);
    if (!p || !isEventEnabledForRecipient(p, byUser.get(userId), type)) continue;
    const dmStatus = p.dm_enabled ? 'pending' : 'skipped';
    const schedule = normalizeNotificationSchedule(p);
    const deliveryMode = schedule.dmDeliveryMode;
    const notBefore = dmStatus === 'pending' ? dmNotBefore(nowSec, schedule) : 0;
    const row = await get(
      `INSERT INTO user_notifications (
         discord_user_id, type, match_id, title, body, url, dedupe_key,
         dm_status, dm_delivery_mode, dm_not_before
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (discord_user_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [userId, type, matchId ?? null, title, body, url, dedupeKey, dmStatus, deliveryMode, notBefore],
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

export async function listPendingDmNotifications(limit = 20, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const safeNow = Math.floor(Number(nowSec));
  if (!Number.isFinite(safeNow)) throw new Error('listPendingDmNotifications requires a unix-seconds nowSec.');
  return all(
    `SELECT * FROM user_notifications
     WHERE dm_status = 'pending' AND COALESCE(dm_not_before, 0) <= $1
     ORDER BY id ASC LIMIT $2`,
    [safeNow, Math.min(100, Math.max(1, Number(limit) || 20))],
  );
}

export async function setDmStatus(id, status) {
  if (!['sent', 'skipped', 'failed'].includes(status)) throw new Error(`Invalid dm_status: ${status}`);
  await run('UPDATE user_notifications SET dm_status = $1 WHERE id = $2', [status, id]);
}

export async function setDmStatuses(ids, status) {
  if (!['sent', 'skipped', 'failed'].includes(status)) throw new Error(`Invalid dm_status: ${status}`);
  const safeIds = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!safeIds.length) return 0;
  return transaction(async (tx) => {
    const placeholders = safeIds.map((_, index) => `$${index + 2}`).join(', ');
    const result = await tx.run(
      `UPDATE user_notifications SET dm_status = $1
       WHERE dm_status = 'pending' AND id IN (${placeholders})`,
      [status, ...safeIds],
    );
    return result.changes || 0;
  });
}
