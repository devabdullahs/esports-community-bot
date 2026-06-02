import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { loadModules } from './loaders.js';

const srcDir = dirname(dirname(fileURLToPath(import.meta.url)));

export async function collectCommandJson() {
  const commands = [];
  for (const { mod } of await loadModules(join(srcDir, 'commands'))) {
    if (mod.data) commands.push(mod.data.toJSON());
  }
  return commands;
}

export async function deployCommands() {
  const commands = await collectCommandJson();
  const rest = new REST().setToken(config.discord.token);

  logger.info(`Deploying ${commands.length} command(s)...`);
  if (config.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
      body: commands,
    });
    logger.info(`Deployed commands to guild ${config.discord.guildId} (effective immediately).`);
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
    logger.info('Deployed commands globally (can take up to 1 hour to appear).');
  }
}
