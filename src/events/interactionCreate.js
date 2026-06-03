import { Events, MessageFlags } from 'discord.js';
import { logger } from '../lib/logger.js';

export const name = Events.InteractionCreate;

export async function execute(interaction) {
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

  // Buttons / modal submits — routed to the owning command by the "<commandName>:" custom_id
  // prefix (e.g. "ewc_predict:lb:..."), which exposes handleComponent / handleModal.
  if (interaction.isButton() || interaction.isModalSubmit()) {
    const command = interaction.client.commands.get(String(interaction.customId).split(':')[0]);
    const handler = interaction.isButton() ? command?.handleComponent : command?.handleModal;
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

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Received unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error(`Error in /${interaction.commandName}:`, err);
    const payload = { content: '⚠️ Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}
