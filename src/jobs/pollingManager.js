import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as liquipedia from '../services/liquipedia.js';
import * as pandascore from '../services/pandascore.js';
import * as startgg from '../services/startgg.js';
import {
  upsertMatch,
  toMatchRow,
  getMatch,
  getActiveMatches,
  markFinishedByExternalId,
  deleteResolvedLiveAliasMatches,
  deleteTournamentPlaceholderMatches,
  deleteTournamentDuplicateMatches,
} from '../db/matches.js';
import { getMatchDetailsFetchedAt, upsertMatchDetails } from '../db/matchDetails.js';
import { getTournamentById } from '../db/tournaments.js';
import { replaceTournamentStandings } from '../db/tournamentStandings.js';
import { fetchTournamentSchedule } from './tournamentScheduleFetch.js';

// Targeted backoff polling: a match is polled (every livePollIntervalMs) only while it is
// actually running, and polling stops the moment it finishes / leaves the ticker. Matches
// scheduled later today are "armed" with a timer that begins polling at their start time.
const services = { liquipedia, pandascore, startgg };
const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_RUN_SECONDS = 8 * 3600; // safety net: stop polling 8h after a match's start time
const MAX_TIMEOUT_MS = 2_147_483_647;
// Must stay wider than the daily (24h) morning-sync interval: that sync is the only re-arm
// for tournaments with no live match, so a cap of 48h guarantees every match is armed with at
// least one full sync cycle of lead instead of (at 24h) possibly only seconds.
const DEFAULT_ARM_LOOKAHEAD_SECONDS = 48 * 3600;
const ARM_LOOKAHEAD_SECONDS = Math.max(
  3600,
  Number(process.env.POLL_ARM_LOOKAHEAD_SECONDS || DEFAULT_ARM_LOOKAHEAD_SECONDS),
);

const watchers = new Map(); // external_id -> { armTimer?, pollTimer? }
const detailRefreshes = new Map(); // match.id -> { promise, finalRequested }
const MATCH_DETAIL_GAMES = new Set(['valorant', 'dota2']);

export async function persistFetchedStandings(matches, tournamentId, { replace = replaceTournamentStandings } = {}) {
  const standings = matches?.standings;
  if (!standings || (!standings.sections?.length && !standings.hadRows)) return 0;
  return replace(tournamentId, standings.sections || []);
}

// The refresh handler ignores the type; the notifier keys on 'started'/'finished'.
// A row first seen already running still counts as started (mid-match discovery),
// but a first-seen finished row does not (bulk schedule import, not an event).
function transitionType(before, row) {
  if (row.status === 'running' && (!before || before.status !== 'running')) return 'started';
  if (before && before.status !== 'finished' && row.status === 'finished') return 'finished';
  return 'update';
}

export function isPlaceholderTeam(value) {
  const name = String(value ?? '').trim();
  return (
    !name ||
    /^TBD$/i.test(name) ||
    /^to be determined$/i.test(name) ||
    /^bye$/i.test(name) ||
    /^(?:lower|higher)\s+seed\b/i.test(name) ||
    /^(?:remaining|selection)$/i.test(name) ||
    /^gauntlet winner\b/i.test(name) ||
    /^group\s+[A-Z]\s*#\d+$/i.test(name) ||
    /^(?:legend|rise)\s+group\s*#\d+$/i.test(name)
  );
}

function isNonPollableMatch(match) {
  return match.source === 'startgg' && startgg.isPreviewExternalId?.(match.external_id);
}

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
  if (w.firstPollTimer) clearTimeout(w.firstPollTimer);
  if (w.pollTimer) clearInterval(w.pollTimer);
  watchers.delete(externalId);
}

function isServiceBackoff(error) {
  return (
    /Liquipedia: backing off after a rate limit/i.test(error?.message || '') ||
    startgg.isStartggRateLimitBackoff?.(error)
  );
}

export function stopAll() {
  for (const id of [...watchers.keys()]) clearWatcher(id);
}

// Schedule polling for a match: immediately if it has started, else at its start time.
export function armMatch(match, tournament, { initialPollDelayMs = 0 } = {}) {
  if (match.status === 'finished') return false;
  if (watchers.has(match.external_id)) return false; // already armed or polling
  if (isNonPollableMatch(match)) return false;
  if (isPlaceholderTeam(match.team_a) || isPlaceholderTeam(match.team_b)) return false;
  if (!match.scheduled_at && match.status !== 'running') return false;

  const delaySec = match.scheduled_at ? match.scheduled_at - nowSec() : 0;
  if (delaySec <= 0) {
    startPolling(match, tournament, { initialPollDelayMs });
    return true;
  }
  if (delaySec > ARM_LOOKAHEAD_SECONDS) {
    logger.debug(`[poll] not arming ${match.external_id}; starts in ${Math.round(delaySec / 60)}m`);
    return false;
  }
  if (delaySec * 1000 > MAX_TIMEOUT_MS) {
    logger.debug(`[poll] not arming ${match.external_id}; start is beyond Node's timer limit`);
    return false;
  }
  const w = {};
  w.armTimer = setTimeout(() => startPolling(match, tournament), delaySec * 1000);
  watchers.set(match.external_id, w);
  logger.info(`[poll] armed ${match.external_id} — starts in ${Math.round(delaySec / 60)}m`);
  return true;
}

function startPolling(match, tournament, { initialPollDelayMs = 0 } = {}) {
  const w = watchers.get(match.external_id) || {};
  if (w.pollTimer || w.firstPollTimer) return;
  logger.info(`[poll] start ${match.external_id} (${match.team_a} vs ${match.team_b})`);
  const tick = () =>
    pollOnce(match, tournament).catch((e) => {
      const message = `[poll] ${match.external_id}: ${e.message}`;
      if (isServiceBackoff(e)) logger.debug(message);
      else logger.error(message);
    });
  const startLoop = () => {
    const current = watchers.get(match.external_id);
    if (!current) return;
    current.firstPollTimer = null;
    current.pollTimer = setInterval(tick, config.scheduler.livePollIntervalMs);
    watchers.set(match.external_id, current);
    tick();
  };
  const delay = Math.max(0, Number(initialPollDelayMs) || 0);
  if (delay) {
    w.firstPollTimer = setTimeout(startLoop, delay);
    w.firstPollTimer.unref?.();
    watchers.set(match.external_id, w);
    logger.info(`[poll] first refresh for ${match.external_id} in ${Math.round(delay / 1000)}s`);
    return;
  }
  watchers.set(match.external_id, w);
  startLoop();
}

function fetchedMoreThanSecondsAgo(fetchedAt, seconds) {
  if (!fetchedAt) return true;
  const timestamp = Date.parse(`${String(fetchedAt).replace(' ', 'T').replace(/Z$/, '')}Z`);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > seconds * 1000;
}

async function refreshMatchDetails(match, tournament, { force = false } = {}) {
  if (
    !config.liquipedia.matchDetailsEnabled ||
    match.source !== 'liquipedia' ||
    !/^Match:/i.test(match.external_id) ||
    !MATCH_DETAIL_GAMES.has(tournament.game) ||
    (!force && match.status !== 'running')
  )
    return;
  const fetchedAt = await getMatchDetailsFetchedAt(match.id);
  if (!force && !fetchedMoreThanSecondsAgo(fetchedAt, 300)) return;

  const payload = await liquipedia.fetchMatchDetails(tournament.game, match.external_id, {
    teamA: match.team_a,
    teamB: match.team_b,
    maxAgeMs: force ? 0 : 300_000,
  });
  if (!payload) return;
  await upsertMatchDetails({
    matchId: match.id,
    sourcePage: match.external_id,
    game: tournament.game,
    payload,
  });
}

function queueMatchDetailsRefresh(match, tournament) {
  const current = detailRefreshes.get(match.id);
  if (current) {
    if (match.status === 'finished') current.finalRequested = true;
    return;
  }
  const state = { finalRequested: false };
  const force = match.status === 'finished';
  const promise = refreshMatchDetails(match, tournament, { force })
    .catch((error) => logger.warn(`[poll] match details ${match.external_id}: ${error.message}`))
    .finally(() => {
      detailRefreshes.delete(match.id);
      if (state.finalRequested) queueMatchDetailsRefresh({ ...match, status: 'finished' }, tournament);
    });
  state.promise = promise;
  detailRefreshes.set(match.id, state);
}

async function pollOnce(match, tournament) {
  const service = services[match.source];
  if (!service?.fetchSchedule) {
    clearWatcher(match.external_id);
    return;
  }

  const all = await fetchTournamentSchedule(service, tournament);
  const currentIds = all.map((m) => m.externalId);
  await persistFetchedStandings(all, match.tournament_id);

  // Refresh EVERY match in this tournament so live scores, final results, winners, and any
  // later corrections all propagate — not just the one match this watcher is tied to.
  let polled = null;
  for (const fresh of all) {
    const before = await getMatch(fresh.source, fresh.externalId);
    const row = await upsertMatch(toMatchRow(fresh, match.tournament_id));
    const changed =
      !before ||
      before.score_a !== row.score_a ||
      before.score_b !== row.score_b ||
      before.status !== row.status ||
      before.logo_a !== row.logo_a ||
      before.logo_b !== row.logo_b;
    if (changed) onUpdate(transitionType(before, row), row);
    if (!watchers.has(row.external_id) && row.status !== 'finished') armMatch(row, tournament);
    if (fresh.externalId === match.external_id) polled = row;
  }
  const deleted = await deleteTournamentPlaceholderMatches(match.tournament_id, currentIds);
  if (deleted) logger.info(`[poll] removed ${deleted} stale placeholder match(es) for tournament ${match.tournament_id}`);
  const dupes = await deleteTournamentDuplicateMatches(match.tournament_id, currentIds);
  if (dupes) logger.info(`[poll] removed ${dupes} duplicate match row(s) for tournament ${match.tournament_id}`);
  // Either cleanup can remove THIS watcher's row (a placeholder that resolved, or a
  // duplicate twin the current fetch dropped) — stop polling a row that no longer exists.
  if ((deleted || dupes) && !(await getMatch(match.source, match.external_id))) {
    clearWatcher(match.external_id);
    return;
  }

  // The windowed start.gg fetch can't include every set of a huge open, so the match
  // this watcher tracks may be absent from `all`. Fetch THAT set directly to get its
  // true state (running/finished) instead of waiting out the max-runtime safety net.
  if (!polled && typeof service.fetchMatch === 'function') {
    const fresh = await service.fetchMatch(match.external_id).catch((e) => {
      logger.debug(`[poll] ${match.external_id} direct fetch failed: ${e.message}`);
      return null;
    });
    if (fresh) {
      const before = await getMatch(fresh.source, fresh.externalId);
      const row = await upsertMatch(toMatchRow(fresh, match.tournament_id));
      const changed =
        !before ||
        before.score_a !== row.score_a ||
        before.score_b !== row.score_b ||
        before.status !== row.status;
      if (changed) onUpdate(transitionType(before, row), row);
      polled = row;
    }
  }

  if (polled) {
    // Detail work is detached from the score poll. Its fetcher still uses the
    // shared Liquipedia queue, but a slow or failed detail page never blocks scores.
    queueMatchDetailsRefresh(polled, tournament);
    // Stop watching only on a genuine finish (the bracket marks a winner) — never on a mere
    // disappearance from the page, which previously caused false/early "finished" results.
    if (polled.status === 'finished') {
      clearWatcher(match.external_id);
      logger.info(`[poll] stop ${match.external_id} (finished ${polled.score_a}-${polled.score_b})`);
    }
  } else if (match.scheduled_at && nowSec() > match.scheduled_at + MAX_RUN_SECONDS) {
    // Safety net: gone from the page and long overdue. Mark it finished (no score) so it
    // leaves the live match-card board instead of staying stuck 'running' forever, then
    // refresh so the card is dropped and the upcoming-matches card takes its place.
    await markFinishedByExternalId(match.source, match.external_id);
    clearWatcher(match.external_id);
    // Deliberately 'update', not 'finished': this is a synthetic timeout-finish with
    // no real result. Emitting 'finished' would DM followers a scoreless "result" AND
    // burn the dedupe key so the genuine result could never notify.
    onUpdate('update', { ...match, status: 'finished' });
    logger.info(`[poll] stop ${match.external_id} (gone, max runtime — marked finished)`);
  }
}

// After a restart, re-arm polling for matches still pending/running in the DB.
export async function resumePolling() {
  const retiredAliases = await deleteResolvedLiveAliasMatches();
  if (retiredAliases) logger.info(`[poll] retired ${retiredAliases} stale live alias match row(s) before resume.`);

  let armed = 0;
  let skipped = 0;
  for (const row of await getActiveMatches()) {
    const tournament = await getTournamentById(row.tournament_id);
    if (!tournament) continue;
    if (armMatch(row, tournament, { initialPollDelayMs: config.scheduler.pollResumeDelayMs })) armed++;
    else skipped++;
  }
  if (armed || skipped) logger.info(`[poll] resumed ${armed} pending/running match watcher(s) after restart; skipped ${skipped}.`);
}
