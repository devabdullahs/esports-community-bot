import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { loadModules } from './lib/loaders.js';

// Registers slash commands with Discord. Run with `npm run deploy` whenever a command's
// definition changes. Guild-scoped (DISCORD_GUILD_ID set) = instant; global = up to ~1h.
const here = dirname(fileURLToPath(import.meta.url));

const commands = [];
for (const { mod } of await loadModules(join(here, 'commands'))) {
  if (mod.data) commands.push(mod.data.toJSON());
}

const rest = new REST().setToken(config.discord.token);

try {
  logger.info(`Deploying ${commands.length} command(s)…`);
  if (config.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
      body: commands,
    });
    logger.info(`Deployed to guild ${config.discord.guildId} (effective immediately).`);
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
    logger.info('Deployed globally (can take up to ~1 hour to appear).');
  }
} catch (err) {
  logger.error('Command deployment failed:', err);
  process.exit(1);
}
