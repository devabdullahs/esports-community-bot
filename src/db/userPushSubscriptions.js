import { randomUUID } from 'node:crypto';

import { all, get, run, transaction } from './client.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function upsertPushSubscription({
  discordUserId,
  endpoint,
  p256dh,
  auth,
}) {
  const timestamp = nowText();
  const row = await get(
    `INSERT INTO user_push_subscriptions (
       id, discord_user_id, endpoint, p256dh, auth, created_at, updated_at,
       last_failure_at, failure_count, revoked_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, NULL, 0, NULL)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       updated_at = excluded.updated_at,
       last_failure_at = NULL,
       failure_count = 0,
       revoked_at = NULL
     WHERE user_push_subscriptions.discord_user_id = excluded.discord_user_id
     RETURNING *`,
    [randomUUID(), discordUserId, endpoint, p256dh, auth, timestamp],
  );
  if (row) return row;

  const error = new Error('Push subscription belongs to another account.');
  error.code = 'PUSH_SUBSCRIPTION_OWNER_CONFLICT';
  throw error;
}

export async function listPushSubscriptionsForUser(discordUserId) {
  return all(
    `SELECT id, created_at, updated_at
     FROM user_push_subscriptions
     WHERE discord_user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [discordUserId],
  );
}

export async function revokePushSubscriptionForUser({ discordUserId, subscriptionId }) {
  const result = await run(
    `UPDATE user_push_subscriptions
     SET revoked_at = $1, updated_at = $1
     WHERE id = $2 AND discord_user_id = $3 AND revoked_at IS NULL`,
    [nowText(), subscriptionId, discordUserId],
  );
  return result.changes || 0;
}

export async function revokePushSubscriptionEndpointForUser({ discordUserId, endpoint }) {
  const result = await run(
    `UPDATE user_push_subscriptions
     SET revoked_at = $1, updated_at = $1
     WHERE endpoint = $2 AND discord_user_id = $3 AND revoked_at IS NULL`,
    [nowText(), endpoint, discordUserId],
  );
  return result.changes || 0;
}

export async function listDuePushDeliveries(limit = 50, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const safeNow = Math.floor(Number(nowSec));
  if (!Number.isFinite(safeNow)) throw new Error('listDuePushDeliveries requires a unix-seconds nowSec.');
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 50)));
  return all(
    `SELECT
       d.notification_id, d.subscription_id, d.attempts,
       s.endpoint, s.p256dh, s.auth,
       n.type, n.title, n.body, n.url, n.dedupe_key
     FROM user_push_deliveries d
     JOIN user_push_subscriptions s ON s.id = d.subscription_id
     JOIN user_notifications n ON n.id = d.notification_id
     WHERE d.status = 'pending'
       AND d.not_before <= $1
       AND s.revoked_at IS NULL
     ORDER BY d.not_before ASC, d.notification_id ASC
     LIMIT $2`,
    [safeNow, safeLimit],
  );
}

export async function markPushDeliverySent({ notificationId, subscriptionId }) {
  const result = await run(
    `UPDATE user_push_deliveries
     SET status = 'sent', attempts = attempts + 1, delivered_at = $1,
         last_failure_at = NULL, last_failure_code = NULL
     WHERE notification_id = $2 AND subscription_id = $3 AND status = 'pending'`,
    [nowText(), notificationId, subscriptionId],
  );
  return result.changes || 0;
}

export async function markPushDeliveryFailed({
  notificationId,
  subscriptionId,
  failureCode = 'delivery_error',
}) {
  const timestamp = nowText();
  return transaction(async (tx) => {
    const result = await tx.run(
      `UPDATE user_push_deliveries
       SET status = 'failed', attempts = attempts + 1,
           last_failure_at = $1, last_failure_code = $2
       WHERE notification_id = $3 AND subscription_id = $4 AND status = 'pending'`,
      [timestamp, String(failureCode).slice(0, 64), notificationId, subscriptionId],
    );
    if (result.changes) {
      await tx.run(
        `UPDATE user_push_subscriptions
         SET last_failure_at = $1, failure_count = failure_count + 1, updated_at = $1
         WHERE id = $2`,
        [timestamp, subscriptionId],
      );
    }
    return result.changes || 0;
  });
}

export async function revokeGonePushSubscription({ subscriptionId, failureCode }) {
  const timestamp = nowText();
  return transaction(async (tx) => {
    const subscription = await tx.run(
      `UPDATE user_push_subscriptions
       SET revoked_at = $1, last_failure_at = $1,
           failure_count = failure_count + 1, updated_at = $1
       WHERE id = $2 AND revoked_at IS NULL`,
      [timestamp, subscriptionId],
    );
    await tx.run(
      `UPDATE user_push_deliveries
       SET status = 'skipped', attempts = attempts + 1,
           last_failure_at = $1, last_failure_code = $2
       WHERE subscription_id = $3 AND status = 'pending'`,
      [timestamp, String(failureCode || 'gone').slice(0, 64), subscriptionId],
    );
    return subscription.changes || 0;
  });
}
