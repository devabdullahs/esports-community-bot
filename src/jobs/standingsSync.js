import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { listActiveTournaments } from '../db/tournaments.js';
import { replaceTournamentStandings } from '../db/tournamentStandings.js';
import * as defaultLiquipedia from '../services/liquipedia.js';

// Tournament tracking for standings-format games. Battle-royale events and TFT
// groups have no head-to-head matches for the poller to arm, so their pages are
// re-parsed on a gentle fixed cadence instead: one parse per tournament, every
// few hours, through the same serialized Liquipedia queue as everything else.
// 8 active events = ~4 minutes of queue time per sweep at the >=30s gap.
const STANDINGS_GAMES = new Set([
  'apexlegends',
  'fortnite',
  'freefire',
  'pubg',
  'pubgmobile',
  'tft',
  'warzone',
]);

let task = null;
let bootTimer = null;
let running = false;

export function isStandingsGame(game) {
  return STANDINGS_GAMES.has(String(game ?? '').trim().toLowerCase());
}

export async function runStandingsSync({ liquipedia = defaultLiquipedia } = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  const summary = { tournaments: 0, rows: 0, empty: 0, failed: 0 };
  try {
    const tournaments = (await listActiveTournaments()).filter(
      (t) => t.source === 'liquipedia' && isStandingsGame(t.game),
    );
    for (const tournament of tournaments) {
      try {
        const { sections, hadTables } = await liquipedia.fetchEventStandings(tournament);
        summary.tournaments += 1;
        if (!sections.length) {
          summary.empty += 1;
          // Clear stored rows ONLY when the page had recognized standings tables
          // that were all-TBD (an unseeded event) — standings are re-derived each
          // run, so that keeps the directory's hasStandings flag accurate. If the
          // page had NO standings structure at all (hadTables false), that could
          // be a transient/partial page or a DOM change, so leave rows intact
          // rather than risk wiping good data. A fetch FAILURE throws and is
          // handled below, also leaving rows intact.
          if (hadTables) await replaceTournamentStandings(tournament.id, []);
          continue;
        }
        summary.rows += await replaceTournamentStandings(tournament.id, sections);
      } catch (error) {
        summary.failed += 1;
        const message = `[standings] ${tournament.external_id}: ${error.message}`;
        if (/backing off after a rate limit/i.test(error.message)) logger.debug(message);
        else logger.warn(message);
      }
    }
    if (summary.tournaments) {
      logger.info(
        `[standings] refreshed ${summary.rows} row(s) across ${summary.tournaments} event(s) (${summary.empty} empty, ${summary.failed} failed).`,
      );
    }
    return summary;
  } finally {
    running = false;
  }
}

export function startStandingsSync() {
  if (!config.standings.enabled) {
    logger.info('[standings] disabled (set STANDINGS_SYNC_ENABLED=true to enable).');
    return;
  }
  if (!cron.validate(config.standings.cron)) {
    logger.warn(`[standings] invalid cron "${config.standings.cron}" - standings sync disabled.`);
    return;
  }
  const runSafe = () => runStandingsSync().catch((e) => logger.warn(`[standings] ${e.message}`));
  task = cron.schedule(config.standings.cron, runSafe, { timezone: config.standings.timezone });
  logger.info(`[standings] scheduled "${config.standings.cron}" (${config.standings.timezone}).`);
  bootTimer = setTimeout(runSafe, config.standings.bootDelayMs);
  bootTimer.unref?.();
}

export function stopStandingsSync() {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (task) {
    task.stop();
    task = null;
  }
}
