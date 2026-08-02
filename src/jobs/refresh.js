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

// Coalesces rapid match updates into one leaderboard+voice refresh per guild.
const DEBOUNCE_MS = 2500;
const pending = new Map(); // guildId -> timer

export function refreshGuild(client, guildId) {
  if (!guildId || pending.has(guildId)) return;
  const t = setTimeout(async () => {
    pending.delete(guildId);
    try {
      await updateLeaderboard(client, guildId);
    } catch (e) {
      logger.error(`[refresh] leaderboard ${guildId}: ${e.message}`);
    }
    try {
      await updateVoiceChannel(client, guildId);
    } catch (e) {
      logger.error(`[refresh] voice ${guildId}: ${e.message}`);
    }
    try {
      await updateMatchCards(client, guildId);
    } catch (e) {
      logger.error(`[refresh] match card ${guildId}: ${describeError(e)}`);
    }
  }, DEBOUNCE_MS);
  t.unref?.();
  pending.set(guildId, t);
}

// Called by the polling manager's update hook (see events/ready.js).
export async function onMatchUpdate(client, _type, match) {
  if (!match) return;
  const tournament = await getTournamentById(match.tournament_id);
  if (tournament?.guild_id) refreshGuild(client, tournament.guild_id);
}

export async function refreshAllGuilds(client) {
  const tournaments = await listActiveTournaments();
  for (const guildId of new Set(tournaments.map((t) => t.guild_id))) {
    refreshGuild(client, guildId);
  }
}
