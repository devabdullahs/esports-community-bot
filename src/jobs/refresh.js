import { config } from '../config.js';
import { createCoalescedRefresh } from '../lib/coalescedRefresh.js';
import { logger } from '../lib/logger.js';
import { getTournamentById, listActiveTournaments } from '../db/tournaments.js';
import { updateLeaderboard } from './leaderboard.js';
import { updateVoiceChannel } from './voiceStatus.js';
import { updateMatchCards } from './matchCardBoard.js';

// discord.js validates payloads with @sapphire/shapeshift, whose combined errors all
// carry the same useless message ("Received one or more errors") and hide the field that
// actually failed. Unwrap the nested causes so a broken card is diagnosable from the log.
function describeError(error, depth = 0) {
  const message = error?.message || String(error);
  const nested = Array.isArray(error?.errors) ? error.errors : null;
  if (!nested?.length || depth >= 2) return message;
  return `${message} [${nested.slice(0, 5).map((cause) => describeError(cause, depth + 1)).join('; ')}]`;
}

const refreshes = createCoalescedRefresh(async (guildId, client) => {
  // Independent surfaces must not wait for a slow leaderboard upload.
  await Promise.all([
    ['leaderboard', updateLeaderboard],
    ['voice', updateVoiceChannel],
    ['match card', updateMatchCards],
  ].map(async ([label, update]) => {
    try {
      await update(client, guildId);
    } catch (error) {
      logger.error(`[refresh] ${label} ${guildId}: ${describeError(error)}`);
    }
  }));
}, { onError: (error, guildId) => logger.error(`[refresh] ${guildId}: ${describeError(error)}`) });

export function refreshGuild(client, guildId) {
  refreshes.request(guildId, client);
}

let sweepTimer = null;
export function startRefreshLoop(client) {
  if (sweepTimer) return;
  // Stored data only: retries Discord failures without additional provider requests.
  sweepTimer = setInterval(() => {
    refreshAllGuilds(client).catch((error) => logger.error(`[refresh] sweep: ${describeError(error)}`));
  }, 60_000);
  sweepTimer.unref?.();
}

export function stopRefreshLoop() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  refreshes.stop();
}

// Called by the polling manager's update hook (see events/ready.js).
export async function onMatchUpdate(client, _type, match) {
  if (!match) return;
  const tournament = await getTournamentById(match.tournament_id);
  if (tournament?.guild_id) refreshGuild(client, tournament.guild_id);
}

export async function refreshAllGuilds(client) {
  const tournaments = await listActiveTournaments();
  for (const guildId of new Set([config.discord.guildId, ...tournaments.map((t) => t.guild_id)].filter(Boolean))) {
    refreshGuild(client, guildId);
  }
}
