import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'push-notifications-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { all, get } = await import('../src/db/client.js');
const {
  listPushSubscriptionsForUser,
  revokePushSubscriptionForUser,
  upsertPushSubscription,
} = await import('../src/db/userPushSubscriptions.js');
const { enqueueNotifications, upsertNotificationPrefs } = await import('../src/db/userNotifications.js');
const { drainPushQueue } = await import('../src/jobs/pushNotifier.js');

const USER = '300000000000000001';
const OTHER_USER = '300000000000000002';
const endpoint = 'https://push.example.test/subscription/one';

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('subscription lifecycle replaces keys, protects ownership, and exposes no secrets in listings', async () => {
  const created = await upsertPushSubscription({
    discordUserId: USER,
    endpoint,
    p256dh: 'p256dh-first',
    auth: 'auth-first',
  });
  const replaced = await upsertPushSubscription({
    discordUserId: USER,
    endpoint,
    p256dh: 'p256dh-second',
    auth: 'auth-second',
  });
  assert.equal(replaced.id, created.id);
  assert.equal(replaced.failure_count, 0);

  const listed = await listPushSubscriptionsForUser(USER);
  assert.equal(listed.length, 1);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['created_at', 'id', 'updated_at']);
  const stored = await get('SELECT endpoint, p256dh, auth FROM user_push_subscriptions WHERE id = $1', [created.id]);
  assert.deepEqual(stored, { endpoint, p256dh: 'p256dh-second', auth: 'auth-second' });

  await assert.rejects(
    () => upsertPushSubscription({
      discordUserId: OTHER_USER,
      endpoint,
      p256dh: 'stolen-key',
      auth: 'stolen-auth',
    }),
    (error) => error?.code === 'PUSH_SUBSCRIPTION_OWNER_CONFLICT',
  );
  assert.equal(await revokePushSubscriptionForUser({ discordUserId: OTHER_USER, subscriptionId: created.id }), 0);
});

test('push fan-out is durable, quiet-hours aware, and independent from DM delivery', async () => {
  const now = Math.floor(Date.UTC(2026, 0, 2, 21, 30) / 1000);
  await upsertNotificationPrefs(USER, {
    dmEnabled: false,
    timezone: 'Asia/Riyadh',
    quietStartMinute: 23 * 60,
    quietEndMinute: 7 * 60,
  });
  await enqueueNotifications({
    userIds: [USER],
    type: 'match_start',
    title: 'Team Alpha vs Team Bravo',
    body: 'Push Cup',
    url: 'https://example.test/tournaments/1',
    dedupeKey: 'push:test:quiet',
    nowSec: now,
  });

  const notification = await get(
    `SELECT n.id, n.dm_status, d.status AS push_status, d.not_before
     FROM user_notifications n
     JOIN user_push_deliveries d ON d.notification_id = n.id
     WHERE n.dedupe_key = $1`,
    ['push:test:quiet'],
  );
  assert.equal(notification.dm_status, 'skipped');
  assert.equal(notification.push_status, 'pending');
  assert.equal(notification.not_before, Math.floor(Date.UTC(2026, 0, 3, 4) / 1000));

  let sends = 0;
  const sender = async (_subscription, payload) => {
    sends += 1;
    const parsed = JSON.parse(payload);
    assert.equal(parsed.title, 'Team Alpha vs Team Bravo');
    assert.equal(parsed.body, 'Live now - Push Cup');
  };
  assert.deepEqual(
    await drainPushQueue({ nowSec: notification.not_before - 1, sender, requireConfigured: false }),
    { sent: 0, skipped: 0, failed: 0 },
  );
  assert.deepEqual(
    await drainPushQueue({ nowSec: notification.not_before, sender, requireConfigured: false }),
    { sent: 1, skipped: 0, failed: 0 },
  );
  assert.equal(sends, 1);
  assert.equal(
    (await get('SELECT status FROM user_push_deliveries WHERE notification_id = $1', [notification.id])).status,
    'sent',
  );
});

test('permanently gone endpoints are revoked and all pending deliveries are skipped', async () => {
  await enqueueNotifications({
    userIds: [USER],
    type: 'match_result',
    title: 'Team Alpha 2-0 Team Bravo',
    dedupeKey: 'push:test:gone',
    nowSec: 1_900_000_000,
  });
  const sender = async () => {
    const error = new Error('gone');
    error.statusCode = 410;
    throw error;
  };
  assert.deepEqual(
    await drainPushQueue({ nowSec: 1_900_100_000, sender, requireConfigured: false }),
    { sent: 0, skipped: 1, failed: 0 },
  );
  assert.equal((await listPushSubscriptionsForUser(USER)).length, 0);
  const deliveries = await all(
    `SELECT status, last_failure_code FROM user_push_deliveries
     WHERE subscription_id = (SELECT id FROM user_push_subscriptions WHERE endpoint = $1)`,
    [endpoint],
  );
  assert.ok(deliveries.every((row) => row.status !== 'pending'));
  assert.ok(deliveries.some((row) => row.last_failure_code === 'http_410'));
});
