import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { loadModules } from './lib/loaders.js';
import { closeDbClient, ensurePostgresAppSchema } from './db/client.js';
import { stopAll } from './jobs/pollingManager.js';
import { stopClubChampionship } from './jobs/clubChampionship.js';
import { stopCsRankings } from './jobs/csRankings.js';
import { stopEwcPredictions } from './jobs/ewcPredictions.js';
import { stopEwcPredictionOperations } from './jobs/ewcPredictionOperations.js';
import { stopNewsAnnouncer } from './jobs/newsAnnouncer.js';
import { stopMediaAnnouncer } from './jobs/mediaAnnouncer.js';
import { stopStreamStatusJob } from './jobs/streamStatus.js';
import { stopPandaScoreProfileCache } from './jobs/pandascoreProfiles.js';
import { stopLogoWarmup } from './jobs/logoWarmup.js';
import { stopNotifier } from './jobs/notifier.js';
import { stopLiquipediaEnrichment } from './jobs/liquipediaEnrichment.js';
import { stopStandingsSync } from './jobs/standingsSync.js';
import { startWebAnalyticsRetention, stopWebAnalyticsRetention } from './jobs/webAnalyticsRetention.js';
import { deployCommands } from './lib/commandRegistry.js';
import { backfillIndividualCompetitorProfiles } from './db/players.js';

const here = dirname(fileURLToPath(import.meta.url));

// Slash commands + channel renames need only the Guilds intent (no privileged intents).
// Mentions in message content render but never ping by default; individual
// send calls must opt in explicitly when a configured role should be notified.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [] },
});
client.commands = new Collection();

await ensurePostgresAppSchema();
try {
  const profileBackfill = await backfillIndividualCompetitorProfiles();
  if (profileBackfill.created) {
    logger.info(
      `[profiles] created ${profileBackfill.created} individual competitor profile(s) across ${profileBackfill.games} game(s).`,
    );
  }
} catch (err) {
  logger.warn(`[profiles] individual competitor backfill failed: ${err.message}`);
}
startWebAnalyticsRetention();

// --- Load commands ---
for (const { file, mod } of await loadModules(join(here, 'commands'))) {
  if (mod.data && typeof mod.execute === 'function') {
    client.commands.set(mod.data.name, mod);
    logger.debug(`Command loaded: ${mod.data.name}`);
  } else {
    logger.warn(`Skipping command file (missing data/execute): ${file}`);
  }
}

// --- Load events ---
for (const { file, mod } of await loadModules(join(here, 'events'))) {
  if (!mod.name || typeof mod.execute !== 'function') {
    logger.warn(`Skipping event file (missing name/execute): ${file}`);
    continue;
  }
  const handler = (...args) => mod.execute(...args);
  if (mod.once) client.once(mod.name, handler);
  else client.on(mod.name, handler);
  logger.debug(`Event loaded: ${mod.name}`);
}

// --- Safety nets ---
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => logger.error('Uncaught exception:', err));

async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down.`);
  stopAll();
  stopClubChampionship();
  stopCsRankings();
  stopEwcPredictions();
  stopEwcPredictionOperations();
  stopNewsAnnouncer();
  stopMediaAnnouncer();
  stopStreamStatusJob();
  stopPandaScoreProfileCache();
  stopLogoWarmup();
  stopNotifier();
  stopLiquipediaEnrichment();
  stopStandingsSync();
  stopWebAnalyticsRetention();
  client.destroy();
  await closeDbClient().catch((err) => logger.warn(`Failed to close DB cleanly: ${err.message}`));
  process.exit(0);
}
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

if (config.discord.deployCommandsOnStart) {
  await deployCommands().catch((err) => {
    logger.error('Startup command deployment failed:', err);
    process.exit(1);
  });
} else {
  logger.info('Startup command deployment disabled (set DEPLOY_DISCORD_COMMANDS=true to enable).');
}

client.login(config.discord.token);
