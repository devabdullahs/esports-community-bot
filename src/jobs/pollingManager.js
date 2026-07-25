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
  deleteResolvedLiveAliasMatches,
  deleteTournamentPlaceholderMatches,
  deleteTournamentDuplicateMatches,
  reconcileUntimedTournamentMatches,
} from '../db/matches.js';
import { getMatchDetailsFetchedAt, upsertMatchDetails } from '../db/matchDetails.js';
import {
  getTournamentById,
  isTournamentGenerationActive,
  withActiveTournamentGeneration,
} from '../db/tournaments.js';
import { replaceTournamentStandings } from '../db/tournamentStandings.js';
import { fetchTournamentSchedule } from './tournamentScheduleFetch.js';
import { tournamentProviderAdmissionOptions } from '../services/tournamentProviderAdmission.js';

// Targeted backoff polling: a match is polled (every livePollIntervalMs) only while it is
// actually running, and polling stops the moment it finishes / leaves the ticker. Matches
// scheduled later today are "armed" with a timer that begins polling at their start time.
const services = { liquipedia, pandascore, startgg };
const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_RUN_SECONDS = 8 * 3600; // safety net: stop polling 8h after a match's start time
const MAX_ABSENT_RUN_SECONDS_BY_GAME = new Map([
  // EA FC pairings finish quickly. Once one disappears from the authoritative feed,
  // waiting the generic eight hours leaves completed matches stuck on the live board.
  ['easportsfc', 3 * 3600],
]);
const MAX_TIMEOUT_MS = 2_147_483_647;
// Must stay wider than the daily (24h) morning-sync interval: that sync is the only re-arm
// for tournaments with no live match, so a cap of 48h guarantees every match is armed with at
// least one full sync cycle of lead instead of (at 24h) possibly only seconds.
const DEFAULT_ARM_LOOKAHEAD_SECONDS = 48 * 3600;
const ARM_LOOKAHEAD_SECONDS = Math.max(
  3600,
  Number(process.env.POLL_ARM_LOOKAHEAD_SECONDS || DEFAULT_ARM_LOOKAHEAD_SECONDS),
);

const watchers = new Map(); // external_id -> { tournamentId, generation, armTimer?, pollTimer? }
const detailRefreshes = new Map(); // match.id -> { promise, finalRequested }
const MATCH_DETAIL_GAMES = new Set(['valorant', 'dota2']);

export function maxAbsentRunSeconds(tournament) {
  return MAX_ABSENT_RUN_SECONDS_BY_GAME.get(tournament?.game) || MAX_RUN_SECONDS;
}

export function shouldRetireAbsentMatch(match, tournament, currentTime = nowSec()) {
  return Boolean(
    match?.scheduled_at && currentTime > match.scheduled_at + maxAbsentRunSeconds(tournament),
  );
}

export async function persistFetchedStandings(matches, tournamentId, { replace = replaceTournamentStandings } = {}) {
  const standings = matches?.standings;
  if (!standings || (!standings.sections?.length && !standings.hadRows)) return 0;
  return replace(tournamentId, standings.sections || []);
}

// The refresh handler ignores the type; the notifier keys on 'started'/'finished'.
// A row first seen already running still counts as started (mid-match discovery),
// but a first-seen finished row does not (bulk schedule import, not an event).
export function transitionType(before, row) {
  if (row.status === 'running' && (!before || before.status !== 'running')) return 'started';
  if (before && before.status !== 'finished' && row.status === 'finished') return 'finished';
  return 'update';
}

export function shouldWatchMatch(match) {
  return match?.status === 'scheduled' || match?.status === 'running';
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

export function stopTournament(tournamentId) {
  const target = Number(tournamentId);
  for (const [externalId, watcher] of watchers) {
    if (Number(watcher.tournamentId) === target) clearWatcher(externalId);
  }
}

// Schedule polling for a match: immediately if it has started, else at its start time.
export function armMatch(match, tournament, { initialPollDelayMs = 0 } = {}) {
  if (!shouldWatchMatch(match)) return false;
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
  const w = {
    tournamentId: Number(match.tournament_id ?? tournament.id),
    generation: Number(tournament.lifecycle_generation ?? 0),
  };
  w.armTimer = setTimeout(() => startPolling(match, tournament), delaySec * 1000);
  watchers.set(match.external_id, w);
  logger.info(`[poll] armed ${match.external_id} — starts in ${Math.round(delaySec / 60)}m`);
  return true;
}

function startPolling(match, tournament, { initialPollDelayMs = 0 } = {}) {
  const w = watchers.get(match.external_id) || {
    tournamentId: Number(match.tournament_id ?? tournament.id),
    generation: Number(tournament.lifecycle_generation ?? 0),
  };
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

async function refreshMatchDetails(match, tournament, generation, { force = false } = {}) {
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
  const persisted = await withActiveTournamentGeneration(match.tournament_id, generation, (tx) =>
    upsertMatchDetails(
      {
        matchId: match.id,
        sourcePage: match.external_id,
        game: tournament.game,
        payload,
      },
      { client: tx },
    ),
  );
  if (!persisted.applied) {
    logger.debug(`[poll] discarded stale match details for ${match.external_id}`);
  }
}

function queueMatchDetailsRefresh(match, tournament, generation) {
  const current = detailRefreshes.get(match.id);
  if (current) {
    if (match.status === 'finished') current.finalRequested = true;
    return;
  }
  const state = { finalRequested: false };
  const force = match.status === 'finished';
  const promise = refreshMatchDetails(match, tournament, generation, { force })
    .catch((error) => logger.warn(`[poll] match details ${match.external_id}: ${error.message}`))
    .finally(() => {
      detailRefreshes.delete(match.id);
      if (state.finalRequested) {
        queueMatchDetailsRefresh({ ...match, status: 'finished' }, tournament, generation);
      }
    });
  state.promise = promise;
  detailRefreshes.set(match.id, state);
}

async function persistPollSnapshot(match, tournament, generation, all) {
  return withActiveTournamentGeneration(match.tournament_id, generation, async (tx) => {
    const changes = [];
    const standings = all?.standings;
    if (standings && (standings.sections?.length || standings.hadRows)) {
      await replaceTournamentStandings(match.tournament_id, standings.sections || [], { client: tx });
    }
    for (const fresh of all) {
      const before = await tx.get(
        'SELECT * FROM matches WHERE source = $1 AND external_id = $2',
        [fresh.source, fresh.externalId],
      );
      const row = await upsertMatch(toMatchRow(fresh, match.tournament_id), { client: tx });
      if (fresh.details) {
        await upsertMatchDetails(
          {
            matchId: row.id,
            sourcePage: fresh.detailsSourcePage || fresh.externalId,
            game: tournament.game,
            payload: fresh.details,
          },
          { client: tx },
        );
      }
      changes.push({ before, row, fresh });
    }
    return changes;
  });
}

async function pollOnce(match, tournament) {
  const watcher = watchers.get(match.external_id);
  const generation = Number(watcher?.generation ?? tournament.lifecycle_generation ?? 0);
  if (!(await isTournamentGenerationActive(match.tournament_id, generation))) {
    clearWatcher(match.external_id);
    return;
  }
  const service = services[match.source];
  if (!service?.fetchSchedule) {
    clearWatcher(match.external_id);
    return;
  }

  const fetched = await fetchTournamentSchedule(
    service,
    tournament,
    tournamentProviderAdmissionOptions(match.tournament_id, generation),
  );
  if (!(await isTournamentGenerationActive(match.tournament_id, generation))) {
    clearWatcher(match.external_id);
    return;
  }
  const all = await reconcileUntimedTournamentMatches(match.tournament_id, fetched);
  const currentIds = all.map((m) => m.externalId);
  const snapshot = await persistPollSnapshot(match, tournament, generation, all);
  if (!snapshot.applied) {
    clearWatcher(match.external_id);
    return;
  }

  // Refresh EVERY match in this tournament so live scores, final results, winners, and any
  // later corrections all propagate — not just the one match this watcher is tied to.
  let polled = null;
  for (const { before, row, fresh } of snapshot.value) {
    const changed =
      !before ||
      before.score_a !== row.score_a ||
      before.score_b !== row.score_b ||
      before.status !== row.status ||
      before.winner_side !== row.winner_side ||
      before.result_reason !== row.result_reason ||
      before.logo_a !== row.logo_a ||
      before.logo_b !== row.logo_b;
    if (changed && (await isTournamentGenerationActive(match.tournament_id, generation))) {
      onUpdate(transitionType(before, row), row);
    }
    if (
      !watchers.has(row.external_id) &&
      shouldWatchMatch(row) &&
      (await isTournamentGenerationActive(match.tournament_id, generation))
    ) {
      armMatch(row, { ...tournament, lifecycle_generation: generation });
    }
    if (fresh.externalId === match.external_id) polled = row;
  }
  if (!(await isTournamentGenerationActive(match.tournament_id, generation))) {
    clearWatcher(match.external_id);
    return;
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
      const persisted = await withActiveTournamentGeneration(
        match.tournament_id,
        generation,
        async (tx) => {
          const before = await tx.get(
            'SELECT * FROM matches WHERE source = $1 AND external_id = $2',
            [fresh.source, fresh.externalId],
          );
          const row = await upsertMatch(toMatchRow(fresh, match.tournament_id), { client: tx });
          return { before, row };
        },
      );
      if (!persisted.applied) {
        clearWatcher(match.external_id);
        return;
      }
      const { before, row } = persisted.value;
      const changed =
        !before ||
        before.score_a !== row.score_a ||
        before.score_b !== row.score_b ||
        before.status !== row.status ||
        before.winner_side !== row.winner_side ||
        before.result_reason !== row.result_reason;
      if (changed && (await isTournamentGenerationActive(match.tournament_id, generation))) {
        onUpdate(transitionType(before, row), row);
      }
      polled = row;
    }
  }

  if (polled) {
    // Detail work is detached from the score poll. Its fetcher still uses the
    // shared Liquipedia queue, but a slow or failed detail page never blocks scores.
    queueMatchDetailsRefresh(polled, tournament, generation);
    // Stop watching only on a genuine finish (the bracket marks a winner) — never on a mere
    // disappearance from the page, which previously caused false/early "finished" results.
    if (!shouldWatchMatch(polled)) {
      clearWatcher(match.external_id);
      const detail =
        polled.status === 'finished'
          ? ` ${polled.score_a ?? '?'}-${polled.score_b ?? '?'}`
          : '';
      logger.info(`[poll] stop ${match.external_id} (${polled.status}${detail})`);
    }
  } else if (shouldRetireAbsentMatch(match, tournament)) {
    // Safety net: gone from the page and long overdue. Mark it finished (no score) so it
    // leaves the live match-card board instead of staying stuck 'running' forever, then
    // refresh so the card is dropped and the upcoming-matches card takes its place.
    const retired = await withActiveTournamentGeneration(
      match.tournament_id,
      generation,
      (tx) =>
        tx.run(
          `UPDATE matches
              SET status = 'finished',
                  winner_side = CASE
                    WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a > score_b THEN 'team1'
                    WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_b > score_a THEN 'team2'
                    ELSE winner_side
                  END,
                  result_reason = CASE
                    WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a <> score_b THEN 'normal'
                    ELSE result_reason
                  END,
                  updated_at = $1
            WHERE source = $2 AND external_id = $3 AND status NOT IN ('finished','cancelled')`,
          [new Date().toISOString().slice(0, 19).replace('T', ' '), match.source, match.external_id],
        ),
    );
    if (!retired.applied) {
      clearWatcher(match.external_id);
      return;
    }
    clearWatcher(match.external_id);
    // Deliberately 'update', not 'finished': this is a synthetic timeout-finish with
    // no real result. Emitting 'finished' would DM followers a scoreless "result" AND
    // burn the dedupe key so the genuine result could never notify.
    if (await isTournamentGenerationActive(match.tournament_id, generation)) {
      onUpdate('update', { ...match, status: 'finished' });
    }
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
