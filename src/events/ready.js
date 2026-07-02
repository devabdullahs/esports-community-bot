import { Events, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import { logger } from '../lib/logger.js';
import { startMorningSync } from '../jobs/morningSync.js';
import { resumePolling, setUpdateHandler } from '../jobs/pollingManager.js';
import { onMatchUpdate, refreshAllGuilds } from '../jobs/refresh.js';
import { startClubChampionship } from '../jobs/clubChampionship.js';
import { startCsRankings } from '../jobs/csRankings.js';
import { startEwcPredictions } from '../jobs/ewcPredictions.js';
import { startNewsAnnouncer } from '../jobs/newsAnnouncer.js';
import { startMediaAnnouncer } from '../jobs/mediaAnnouncer.js';
import { startStreamStatusJob } from '../jobs/streamStatus.js';
import { startPandaScoreProfileCache } from '../jobs/pandascoreProfiles.js';
import { startLogoWarmup } from '../jobs/logoWarmup.js';
import { notifyMatchEvent, startNotifier } from '../jobs/notifier.js';
import { primeEwcClubCache } from '../lib/ewcClubCache.js';

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

  // When a match's score/status changes, refresh that guild's leaderboard + voice
  // channel, and fan genuine start/finish transitions out to followers.
  setUpdateHandler((type, match) => {
    onMatchUpdate(client, type, match).catch((e) => logger.error(`[refresh] match update failed: ${e.message}`));
    notifyMatchEvent(client, type, match).catch((e) => logger.error(`[notify] match event failed: ${e.message}`));
  });

  startMorningSync(client);
  resumePolling().catch((e) => logger.error(`[poll] resume failed: ${e.message}`)); // re-arm matches still pending/running from before a restart
  refreshAllGuilds(client).catch((e) => logger.error(`[refresh] boot repaint failed: ${e.message}`)); // repaint leaderboards/voice on boot
  startClubChampionship(client); // EWC Club Championship standings refresh loop
  startCsRankings(client); // Counter-Strike Valve rankings refresh loop
  startEwcPredictions(client); // EWC prediction snapshots/scoring automation
  startNewsAnnouncer(client); // Auto-post published news to Discord (per-game / default channel)
  startMediaAnnouncer(client); // Auto-announce opted-in media channels to their Discord channel
  startStreamStatusJob(); // Poll Twitch/Kick for which tracked co-stream channels are live
  startPandaScoreProfileCache(); // Quiet-hours team/player profile cache.
  startLogoWarmup(); // Pre-download tracked-match crests so the web logo proxy can serve them.
  startNotifier(client); // Deliver follower notifications (site inbox rows -> Discord DMs).
  primeEwcClubCache(); // Warm autocomplete without blocking startup.
}
