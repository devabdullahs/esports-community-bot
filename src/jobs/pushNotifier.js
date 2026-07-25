import { createHash } from 'node:crypto';

import { config } from '../config.js';
import {
  listDuePushDeliveries,
  markPushDeliveryFailed,
  markPushDeliverySent,
  revokeGonePushSubscription,
} from '../db/userPushSubscriptions.js';
import { logger } from '../lib/logger.js';

const MAX_PUSHES_PER_DRAIN = 100;
const PERMANENTLY_GONE = new Set([404, 410]);

let sweepTimer = null;
let draining = false;
let webPushClientPromise = null;

function validVapidSubject(value) {
  return /^(mailto:|https:\/\/)/i.test(String(value || ''));
}

function webPushConfigured() {
  return Boolean(
    config.webPush.enabled &&
    config.webPush.publicKey &&
    config.webPush.privateKey &&
    validVapidSubject(config.webPush.subject),
  );
}

async function webPushClient() {
  if (!webPushClientPromise) {
    webPushClientPromise = import('web-push').then((module) => {
      const client = module.default ?? module;
      client.setVapidDetails(config.webPush.subject, config.webPush.publicKey, config.webPush.privateKey);
      return client;
    });
  }
  return webPushClientPromise;
}

async function defaultSender(subscription, payload, options) {
  return (await webPushClient()).sendNotification(subscription, payload, options);
}

function deliveryOptions(row) {
  const topic = createHash('sha256').update(String(row.dedupe_key)).digest('base64url').slice(0, 32);
  return {
    TTL: row.type === 'match_start' ? 60 * 60 : 24 * 60 * 60,
    urgency: row.type === 'match_start' ? 'high' : 'normal',
    topic,
  };
}

function deliveryPayload(row) {
  const eventLabel = row.type === 'match_start' ? 'Live now' : 'Final result';
  return JSON.stringify({
    title: row.title,
    body: row.body ? `${eventLabel} - ${row.body}` : eventLabel,
    url: row.url || '/',
    tag: row.dedupe_key,
    notificationId: row.notification_id,
  });
}

function failureStatus(error) {
  const value = Number(error?.statusCode ?? error?.status);
  return Number.isInteger(value) ? value : null;
}

export async function drainPushQueue({
  limit = MAX_PUSHES_PER_DRAIN,
  nowSec = Math.floor(Date.now() / 1000),
  sender = defaultSender,
  requireConfigured = true,
} = {}) {
  if (draining || (requireConfigured && !webPushConfigured())) {
    return { sent: 0, skipped: 0, failed: 0 };
  }
  draining = true;
  const summary = { sent: 0, skipped: 0, failed: 0 };
  try {
    let processed = 0;
    while (processed < limit) {
      const rows = await listDuePushDeliveries(Math.min(25, limit - processed), { nowSec });
      if (!rows.length) break;
      for (const row of rows) {
        processed += 1;
        const subscription = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
          await sender(subscription, deliveryPayload(row), deliveryOptions(row));
          await markPushDeliverySent({
            notificationId: row.notification_id,
            subscriptionId: row.subscription_id,
          });
          summary.sent += 1;
        } catch (error) {
          const status = failureStatus(error);
          if (PERMANENTLY_GONE.has(status)) {
            await revokeGonePushSubscription({
              subscriptionId: row.subscription_id,
              failureCode: `http_${status}`,
            });
            summary.skipped += 1;
          } else {
            await markPushDeliveryFailed({
              notificationId: row.notification_id,
              subscriptionId: row.subscription_id,
              failureCode: status ? `http_${status}` : 'delivery_error',
            });
            summary.failed += 1;
          }
        }
      }
    }
    if (summary.sent || summary.skipped || summary.failed) {
      logger.info(
        `[push] drain: ${summary.sent} sent, ${summary.skipped} expired, ${summary.failed} failed.`,
      );
    }
    return summary;
  } finally {
    draining = false;
  }
}

export function startPushNotifier() {
  if (sweepTimer || !config.webPush.enabled) return;
  if (!webPushConfigured()) {
    logger.warn('[push] disabled because VAPID configuration is incomplete.');
    return;
  }
  const sweepMs = config.webPush.sweepSeconds * 1000;
  sweepTimer = setInterval(() => {
    void drainPushQueue().catch(() => logger.warn('[push] delivery sweep failed.'));
  }, sweepMs);
  sweepTimer.unref?.();
  void drainPushQueue().catch(() => logger.warn('[push] startup delivery failed.'));
  logger.info('[push] web push delivery started.');
}

export function stopPushNotifier() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
