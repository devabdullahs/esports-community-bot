import { Events, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export const name = Events.InteractionCreate;

// Single-guild trust boundary (security hardening ECB-SEC-010): the bot may
// be INVITED to other guilds, but every interaction outside the configured
// guild is refused BEFORE any dispatch — otherwise foreign-guild members
// could seed persistent scheduled workloads (tracked tournaments, watchers,
// boards) that the shared poller then services forever.
export function isForeignGuildInteraction(interaction, configuredGuildId = config.discord.guildId) {
  if (!configuredGuildId) return false;
  return Boolean(interaction.guildId && interaction.guildId !== configuredGuildId);
}

export async function execute(interaction) {
  if (isForeignGuildInteraction(interaction)) {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]).catch(() => {});
    } else if (interaction.isRepliable?.()) {
      await interaction
        .reply({ content: 'This bot only serves its home community server.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    return;
  }

  // Autocomplete (e.g. /remove_tournament).
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.error(`Autocomplete error in /${interaction.commandName}: ${err.message}`);
      }
    }
    return;
  }

  // Message components / modal submits are routed to the owning command by the "<commandName>:" custom_id
  // prefix (e.g. "ewc_predict:lb:..."), which exposes handleComponent / handleModal.
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    const command = interaction.client.commands.get(String(interaction.customId).split(':')[0]);
    const handler = interaction.isModalSubmit() ? command?.handleModal : command?.handleComponent;
    if (!handler) return;
    try {
      await handler(interaction);
    } catch (err) {
      logger.error(`Interaction handler error (${interaction.customId}): ${err.message}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⚠️ Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Received unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    const label = interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.commandName;
    logger.error(`Error in ${label}:`, err);
    const payload = { content: '⚠️ Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}
