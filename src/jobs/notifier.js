import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { getTournamentById } from '../db/tournaments.js';
import { listFollowerIdsForMatch } from '../db/userFollows.js';
import {
  enqueueNotifications,
  listPendingDmNotifications,
  setDmStatus,
} from '../db/userNotifications.js';
import { isPlaceholderTeam } from './pollingManager.js';

// Discord error code for "Cannot send messages to this user" (DMs closed).
const CANNOT_DM = 50007;
const DM_GAP_MS = 1100; // stay well under Discord's DM rate limits
const MAX_DMS_PER_DRAIN = 100;

let sweepTimer = null;
let draining = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function siteUrl(path) {
  const base = String(config.dashboard.publicUrl || '').replace(/\/$/, '');
  return base ? `${base}${path}` : '';
}

function scoreText(match) {
  return match.score_a != null && match.score_b != null
    ? `${match.team_a} ${match.score_a}–${match.score_b} ${match.team_b}`
    : `${match.team_a} vs ${match.team_b}`;
}

// Fan a match transition out to followers as inbox rows (+ pending DMs). Fired
// from the polling update handler; 'update' events (score ticks, logo changes)
// are ignored — only genuine start/finish transitions notify.
export async function notifyMatchEvent(client, type, match) {
  if (type !== 'started' && type !== 'finished') return null;
  if (!match?.tournament_id) return null;
  if (isPlaceholderTeam(match.team_a) || isPlaceholderTeam(match.team_b)) return null;

  const tournament = await getTournamentById(match.tournament_id);
  if (!tournament || tournament.archived_at) return null;

  const userIds = await listFollowerIdsForMatch({
    game: tournament.game,
    tournamentId: tournament.id,
    teamA: match.team_a,
    teamB: match.team_b,
  });
  if (!userIds.length) return { notified: 0 };

  const notificationType = type === 'started' ? 'match_start' : 'match_result';
  const title = type === 'started' ? `${match.team_a} vs ${match.team_b}` : scoreText(match);
  const inserted = await enqueueNotifications({
    userIds,
    type: notificationType,
    matchId: match.id ?? null,
    title,
    body: tournament.name || '',
    url: siteUrl(`/tournaments/${tournament.id}`),
    dedupeKey: `${notificationType}:${match.source}:${match.external_id}`,
  });

  if (inserted) {
    logger.info(`[notify] ${notificationType} ${match.external_id}: queued ${inserted} notification(s).`);
    void drainDmQueue(client).catch((e) => logger.warn(`[notify] dm drain failed: ${e.message}`));
  }
  return { notified: inserted };
}

function dmContent(row) {
  const label = row.type === 'match_start' ? '\u{1F534} **LIVE**' : '\u{1F3C1} **Result**';
  const lines = [`${label} — ${row.title}`];
  if (row.body) lines.push(`\u{1F3C6} ${row.body}`);
  if (row.url) lines.push(row.url);
  const manage = siteUrl('/me');
  if (manage) lines.push(`-# Manage notifications: ${manage}`);
  return lines.join('\n');
}

// Serial, paced DM delivery. Failures never retry automatically: closed DMs are
// marked skipped, transient errors marked failed — both leave the inbox row
// intact, so the user still sees the notification on the site.
export async function drainDmQueue(client, { limit = MAX_DMS_PER_DRAIN, gapMs = DM_GAP_MS } = {}) {
  if (draining || !client) return { sent: 0, skipped: 0, failed: 0 };
  draining = true;
  const summary = { sent: 0, skipped: 0, failed: 0 };
  try {
    let processed = 0;
    while (processed < limit) {
      const batch = await listPendingDmNotifications(Math.min(20, limit - processed));
      if (!batch.length) break;
      for (const row of batch) {
        processed += 1;
        try {
          const user = await client.users.fetch(row.discord_user_id);
          await user.send({ content: dmContent(row) });
          await setDmStatus(row.id, 'sent');
          summary.sent += 1;
        } catch (error) {
          const code = error?.code ?? error?.rawError?.code;
          const status = code === CANNOT_DM ? 'skipped' : 'failed';
          await setDmStatus(row.id, status);
          summary[status] += 1;
          logger.debug(`[notify] dm to ${row.discord_user_id} ${status}: ${error.message}`);
        }
        await sleep(gapMs);
      }
    }
    if (summary.sent || summary.failed || summary.skipped) {
      logger.info(`[notify] dm drain: ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed.`);
    }
    return summary;
  } finally {
    draining = false;
  }
}

// Periodic sweep so DMs enqueued while offline (or left pending across a
// restart) still deliver without waiting for the next match event.
export function startNotifier(client) {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void drainDmQueue(client).catch((e) => logger.warn(`[notify] sweep failed: ${e.message}`));
  }, 60_000);
  sweepTimer.unref?.();
  logger.info('[notify] follower notification delivery started.');
}

export function stopNotifier() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
