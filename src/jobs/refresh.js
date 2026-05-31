import { logger } from '../lib/logger.js';
import { getTournamentById, listActiveTournaments } from '../db/tournaments.js';
import { updateLeaderboard } from './leaderboard.js';
import { updateVoiceChannel } from './voiceStatus.js';

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
  }, DEBOUNCE_MS);
  t.unref?.();
  pending.set(guildId, t);
}

// Called by the polling manager's update hook (see events/ready.js).
export function onMatchUpdate(client, _type, match) {
  if (!match) return;
  const tournament = getTournamentById(match.tournament_id);
  if (tournament?.guild_id) refreshGuild(client, tournament.guild_id);
}

export function refreshAllGuilds(client) {
  for (const guildId of new Set(listActiveTournaments().map((t) => t.guild_id))) {
    refreshGuild(client, guildId);
  }
}
