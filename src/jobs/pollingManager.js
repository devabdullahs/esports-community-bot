import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as liquipedia from '../services/liquipedia.js';
import * as pandascore from '../services/pandascore.js';
import * as startgg from '../services/startgg.js';
import { upsertMatch, toMatchRow, getMatch, getActiveMatches } from '../db/matches.js';
import { getTournamentById } from '../db/tournaments.js';

// Targeted backoff polling: a match is polled (every livePollIntervalMs) only while it is
// actually running, and polling stops the moment it finishes / leaves the ticker. Matches
// scheduled later today are "armed" with a timer that begins polling at their start time.
const services = { liquipedia, pandascore, startgg };
const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_RUN_SECONDS = 8 * 3600; // safety net: stop polling 8h after a match's start time

const watchers = new Map(); // external_id -> { armTimer?, pollTimer? }

// Hook for the (next-phase) leaderboard embed + live voice-channel updaters.
let onUpdate = () => {};
export function setUpdateHandler(fn) {
  onUpdate = typeof fn === 'function' ? fn : () => {};
}

export function activeCount() {
  return watchers.size;
}

function clearWatcher(externalId) {
  const w = watchers.get(externalId);
  if (!w) return;
  if (w.armTimer) clearTimeout(w.armTimer);
  if (w.pollTimer) clearInterval(w.pollTimer);
  watchers.delete(externalId);
}

export function stopAll() {
  for (const id of [...watchers.keys()]) clearWatcher(id);
}

// Schedule polling for a match: immediately if it has started, else at its start time.
export function armMatch(match, tournament) {
  if (match.status === 'finished') return;
  if (watchers.has(match.external_id)) return; // already armed or polling

  const delaySec = match.scheduled_at ? match.scheduled_at - nowSec() : 0;
  if (delaySec <= 0) {
    startPolling(match, tournament);
    return;
  }
  const w = {};
  w.armTimer = setTimeout(() => startPolling(match, tournament), delaySec * 1000);
  watchers.set(match.external_id, w);
  logger.info(`[poll] armed ${match.external_id} — starts in ${Math.round(delaySec / 60)}m`);
}

function startPolling(match, tournament) {
  const w = watchers.get(match.external_id) || {};
  if (w.pollTimer) return;
  logger.info(`[poll] start ${match.external_id} (${match.team_a} vs ${match.team_b})`);
  const tick = () =>
    pollOnce(match, tournament).catch((e) => logger.error(`[poll] ${match.external_id}: ${e.message}`));
  w.pollTimer = setInterval(tick, config.scheduler.livePollIntervalMs);
  watchers.set(match.external_id, w);
  tick(); // poll right away
}

async function pollOnce(match, tournament) {
  const service = services[match.source];
  if (!service?.fetchSchedule) {
    clearWatcher(match.external_id);
    return;
  }

  const all = await service.fetchSchedule(tournament);

  // Refresh EVERY match in this tournament so live scores, final results, winners, and any
  // later corrections all propagate — not just the one match this watcher is tied to.
  let polled = null;
  for (const fresh of all) {
    const before = getMatch(fresh.source, fresh.externalId);
    const row = upsertMatch(toMatchRow(fresh, match.tournament_id));
    const changed =
      !before || before.score_a !== row.score_a || before.score_b !== row.score_b || before.status !== row.status;
    if (changed) onUpdate('update', row);
    if (fresh.externalId === match.external_id) polled = row;
  }

  if (polled) {
    // Stop watching only on a genuine finish (the bracket marks a winner) — never on a mere
    // disappearance from the page, which previously caused false/early "finished" results.
    if (polled.status === 'finished') {
      clearWatcher(match.external_id);
      logger.info(`[poll] stop ${match.external_id} (finished ${polled.score_a}-${polled.score_b})`);
    }
  } else if (match.scheduled_at && nowSec() > match.scheduled_at + MAX_RUN_SECONDS) {
    // Safety net: gone from the page and long overdue — stop without inventing a result.
    clearWatcher(match.external_id);
    logger.info(`[poll] stop ${match.external_id} (gone, max runtime)`);
  }
}

// After a restart, re-arm polling for matches still pending/running in the DB.
export function resumePolling() {
  let armed = 0;
  for (const row of getActiveMatches()) {
    const tournament = getTournamentById(row.tournament_id);
    if (!tournament) continue;
    armMatch(row, tournament);
    armed++;
  }
  if (armed) logger.info(`[poll] resumed ${armed} pending/running match(es) after restart.`);
}
