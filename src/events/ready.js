import { Events, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import { logger } from '../lib/logger.js';
import { startMorningSync } from '../jobs/morningSync.js';
import { resumePolling, setUpdateHandler } from '../jobs/pollingManager.js';
import { onMatchUpdate, refreshAllGuilds } from '../jobs/refresh.js';
import { startClubChampionship } from '../jobs/clubChampionship.js';
import { startCsRankings } from '../jobs/csRankings.js';
import { startEwcPredictions } from '../jobs/ewcPredictions.js';

// NOTE: in discord.js 14.26 this event's string is "clientReady" — always use the enum.
export const name = Events.ClientReady;
export const once = true;

export function execute(client) {
  logger.info(`Logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s).`);

  // Print an invite link with exactly the permissions this bot needs.
  try {
    const invite = client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels, // rename the live voice channel
      ],
    });
    logger.info(`Invite link: ${invite}`);
  } catch (e) {
    const id = client.application?.id;
    logger.info(
      `Invite link: https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=117776&scope=bot%20applications.commands`,
    );
    logger.debug(`generateInvite fallback: ${e.message}`);
  }

  // When a match's score/status changes, refresh that guild's leaderboard + voice channel.
  setUpdateHandler((type, match) => onMatchUpdate(client, type, match));

  startMorningSync(client);
  resumePolling(); // re-arm matches still pending/running from before a restart
  refreshAllGuilds(client); // repaint leaderboards/voice on boot
  startClubChampionship(client); // EWC Club Championship standings refresh loop
  startCsRankings(client); // Counter-Strike Valve rankings refresh loop
  startEwcPredictions(client); // EWC prediction snapshots/scoring automation
}
