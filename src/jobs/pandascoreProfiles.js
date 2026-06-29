import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { listActiveTournaments } from '../db/tournaments.js';
import { getTeamByPandaScoreId, upsertTeam } from '../db/teams.js';
import { upsertPlayer } from '../db/players.js';
import { normalizeGameSlug } from '../lib/games.js';
import * as defaultPandaScore from '../services/pandascore.js';

let task = null;
let running = false;

function splitGameList(value) {
  return String(value || '')
    .split(/[,\s;|]+/)
    .map((item) => normalizeGameSlug(item.trim().toLowerCase()))
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

export function hourInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
}

export function isQuietHour(
  date = new Date(),
  timezone = config.pandascore.profilesTimezone,
  start = config.pandascore.profilesQuietStartHour,
  end = config.pandascore.profilesQuietEndHour,
) {
  const hour = hourInTimezone(date, timezone);
  const startHour = ((Number(start) || 0) % 24 + 24) % 24;
  const endHour = ((Number(end) || 0) % 24 + 24) % 24;
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export async function trackedPandaScoreGames({ games = null, pandaScore = defaultPandaScore } = {}) {
  const configured = games ? splitGameList(games.join ? games.join(',') : games) : splitGameList(config.pandascore.profilesGames);
  const candidates = configured.length
    ? configured
    : (await listActiveTournaments()).map((tournament) => normalizeGameSlug(tournament.game));

  return unique(candidates)
    .map((game) => pandaScore.canonicalPandaScoreGame?.(game) ?? normalizeGameSlug(game))
    .filter((game) => game && pandaScore.pandascoreGamePath?.(game));
}

export async function refreshPandaScoreProfiles({
  force = false,
  now = new Date(),
  games = null,
  pandaScore = defaultPandaScore,
} = {}) {
  if (!pandaScore.hasPandaScoreToken?.()) {
    logger.info('[pandascore-profiles] PANDASCORE_TOKEN not set - profile cache disabled.');
    return { skipped: 'missing-token', games: [], teams: 0, players: 0, errors: [] };
  }

  if (!force && !isQuietHour(now)) {
    logger.debug('[pandascore-profiles] outside quiet hours - skipping profile refresh.');
    return { skipped: 'outside-quiet-hours', games: [], teams: 0, players: 0, errors: [] };
  }

  if (running) {
    logger.debug('[pandascore-profiles] refresh already running - skipping overlapping run.');
    return { skipped: 'already-running', games: [], teams: 0, players: 0, errors: [] };
  }

  running = true;
  const summary = { skipped: null, games: [], teams: 0, players: 0, errors: [] };

  try {
    const targetGames = await trackedPandaScoreGames({ games, pandaScore });
    summary.games = targetGames;
    if (!targetGames.length) {
      logger.info('[pandascore-profiles] no tracked PandaScore-supported games found.');
      return summary;
    }

    for (const game of targetGames) {
      try {
        const teamByPandaScoreId = new Map();
        const teams = await pandaScore.fetchTeamsForGame(game);
        for (const teamProfile of teams) {
          const team = await upsertTeam(teamProfile);
          teamByPandaScoreId.set(Number(team.pandascore_id), team);
          summary.teams += 1;
        }

        const players = await pandaScore.fetchPlayersForGame(game, teamByPandaScoreId);
        for (const playerProfile of players) {
          const resolvedTeam =
            playerProfile.current_team_id || !playerProfile.current_team_pandascore_id
              ? null
              : teamByPandaScoreId.get(Number(playerProfile.current_team_pandascore_id)) ??
                (await getTeamByPandaScoreId(playerProfile.current_team_pandascore_id));

          await upsertPlayer({
            ...playerProfile,
            current_team_id: playerProfile.current_team_id ?? resolvedTeam?.id ?? null,
          });
          summary.players += 1;
        }
      } catch (error) {
        summary.errors.push({ game, message: error.message });
        logger.warn(`[pandascore-profiles] ${game} refresh failed: ${error.message}`);
      }
    }

    // TODO Phase 2: LPDB-backed prize/earnings enrichment needs LPDB approval,
    // licensing review for player photos, and a separate strict rate budget.
    logger.info(
      `[pandascore-profiles] refreshed ${summary.teams} teams and ${summary.players} players across ${summary.games.length} game(s).`,
    );
    return summary;
  } finally {
    running = false;
  }
}

export function startPandaScoreProfileCache() {
  if (!config.pandascore.profilesEnabled) {
    logger.info('[pandascore-profiles] profile cache disabled (set PANDASCORE_PROFILES_ENABLED=true to enable).');
    return;
  }
  if (!defaultPandaScore.hasPandaScoreToken()) {
    logger.info('[pandascore-profiles] PANDASCORE_TOKEN not set - profile cache disabled.');
    return;
  }
  if (!cron.validate(config.pandascore.profilesCron)) {
    logger.warn(`[pandascore-profiles] invalid cron "${config.pandascore.profilesCron}" - profile cache disabled.`);
    return;
  }

  const runSafe = () => refreshPandaScoreProfiles().catch((e) => logger.warn(`[pandascore-profiles] ${e.message}`));
  task = cron.schedule(config.pandascore.profilesCron, runSafe, {
    timezone: config.pandascore.profilesTimezone,
  });
  logger.info(
    `[pandascore-profiles] scheduled "${config.pandascore.profilesCron}" (${config.pandascore.profilesTimezone}).`,
  );
}

export function stopPandaScoreProfileCache() {
  if (task) {
    task.stop();
    task = null;
  }
}
