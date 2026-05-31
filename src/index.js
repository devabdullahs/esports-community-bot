import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { loadModules } from './lib/loaders.js';
import { closeDb } from './db/index.js';
import { stopAll } from './jobs/pollingManager.js';
import { stopClubChampionship } from './jobs/clubChampionship.js';

const here = dirname(fileURLToPath(import.meta.url));

// Slash commands + channel renames need only the Guilds intent (no privileged intents).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

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

function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down.`);
  stopAll();
  stopClubChampionship();
  client.destroy();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discord.token);
