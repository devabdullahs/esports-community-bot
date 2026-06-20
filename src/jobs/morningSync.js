import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import {
  deactivateTournament,
  listActiveTournaments,
  listEndedTournaments,
  updateTournamentGame,
  updateTournamentName,
} from '../db/tournaments.js';
import {
  deleteResolvedDuplicateMatches,
  deleteTournamentPlaceholderMatches,
  upsertMatch,
  toMatchRow,
} from '../db/matches.js';
import { armMatch } from './pollingManager.js';
import { refreshAllGuilds } from './refresh.js';
import * as liquipedia from '../services/liquipedia.js';
import * as startgg from '../services/startgg.js';
import * as pandascore from '../services/pandascore.js';

// Liquipedia is primary (free, broad coverage); start.gg secondary; pandascore optional.
const services = { liquipedia, startgg, pandascore };

// Fetch one tournament's current matches, persist them, and arm live-polling. Returns count.
export async function syncTournament(client, t) {
  const service = services[t.source];
  if (!service?.fetchSchedule) {
    logger.warn(`[sync] no service for source "${t.source}" (tournament #${t.id}).`);
    return 0;
  }

  if (service.resolveTournamentTitle) {
    try {
      const title = await service.resolveTournamentTitle(t);
      if (title && title !== t.name) {
        await updateTournamentName(t.id, title);
        t = { ...t, name: title };
      }
    } catch (e) {
      logger.debug(`[sync] title lookup failed for ${t.source}:${t.external_id}: ${e.message}`);
    }
  }

  // start.gg URLs don't encode the game, so a fresh start.gg tournament has game=null
  // and won't group under its board. Detect it once from the source's metadata.
  if (!t.game && service.resolveTournamentGame) {
    try {
      const game = await service.resolveTournamentGame(t);
      if (game) {
        await updateTournamentGame(t.id, game);
        t = { ...t, game };
      }
    } catch (e) {
      logger.debug(`[sync] game lookup failed for ${t.source}:${t.external_id}: ${e.message}`);
    }
  }

  const matches = await service.fetchSchedule(t);
  const currentIds = matches.map((m) => m.externalId);
  for (const parsed of matches) {
    const row = await upsertMatch(toMatchRow(parsed, t.id));
    armMatch(row, t);
  }
  const deleted = await deleteTournamentPlaceholderMatches(t.id, currentIds);
  if (deleted) logger.info(`[sync] removed ${deleted} stale placeholder match(es) for ${t.source}:${t.external_id}`);
  return matches.length;
}

// Daily sweep over every tracked tournament. Runs at 08:00 (and on boot if SYNC_ON_BOOT).
export async function runMorningSync(client) {
  logger.info('[morning-sync] Starting daily schedule sync…');

  // Auto-untrack tournaments that fully ended (every match finished) more than
  // TOURNAMENT_UNTRACK_AFTER_HOURS ago (default 72h). Keeps the tracked list and
  // match-card boards focused on live/upcoming events; the end-of-run refresh
  // removes their now-orphaned cards.
  const staleHours = Number(process.env.TOURNAMENT_UNTRACK_AFTER_HOURS) || 72;
  try {
    const ended = await listEndedTournaments(staleHours * 3600);
    for (const t of ended) {
      await deactivateTournament(t.id, t.guild_id);
      logger.info(`[morning-sync] untracked ended tournament #${t.id} "${t.name}" (finished > ${staleHours}h ago).`);
    }
    if (ended.length) logger.info(`[morning-sync] auto-untracked ${ended.length} ended tournament(s).`);
  } catch (err) {
    logger.error(`[morning-sync] auto-untrack failed: ${err.message}`);
  }

  const tournaments = await listActiveTournaments();
  if (!tournaments.length) {
    logger.info('[morning-sync] No tracked tournaments — use /add_tournament.');
    return;
  }

  let total = 0;
  for (const t of tournaments) {
    try {
      const n = await syncTournament(client, t);
      total += n;
      logger.info(`[morning-sync] ${t.source}:${t.external_id} → ${n} match(es).`);
    } catch (err) {
      logger.error(`[morning-sync] ${t.source}:${t.external_id} failed: ${err.message}`);
    }
  }
  logger.info(`[morning-sync] Done — ${tournaments.length} tournament(s), ${total} match(es).`);
  try {
    const retired = await deleteResolvedDuplicateMatches();
    if (retired) logger.info(`[morning-sync] retired ${retired} phantom finished match(es) (resolved elsewhere with a score).`);
  } catch (err) {
    logger.error(`[morning-sync] phantom cleanup failed: ${err.message}`);
  }
  if (client) await refreshAllGuilds(client);
}

export function startMorningSync(client) {
  const { morningCron, timezone, syncOnBoot } = config.scheduler;
  if (!cron.validate(morningCron)) {
    logger.error(`[morning-sync] Invalid cron "${morningCron}" — sync disabled.`);
    return;
  }
  cron.schedule(
    morningCron,
    () => runMorningSync(client).catch((e) => logger.error('[morning-sync] scheduled run failed:', e)),
    { timezone },
  );
  logger.info(`[morning-sync] Scheduled "${morningCron}" (${timezone}).`);

  if (syncOnBoot) {
    runMorningSync(client).catch((e) => logger.error('[morning-sync] boot run failed:', e));
  }
}
