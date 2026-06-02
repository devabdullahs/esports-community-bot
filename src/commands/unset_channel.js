import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  clearCombinedLeaderboard,
  clearCombinedVoiceChannel,
  clearMatchCardMessages,
  deleteGameLeaderboard,
  deleteGameMatchCard,
  deleteGameVoiceChannel,
  getGameLeaderboards,
  getGameMatchCards,
  getMatchCardMessages,
  getSettings,
} from '../db/settings.js';
import { ALL_GAMES } from '../jobs/matchCardBoard.js';
import { gameName, normalizeGameSlug, searchGames } from '../lib/games.js';
import { sendAuditLog } from '../lib/auditLog.js';

export const data = new SlashCommandBuilder()
  .setName('unset_channel')
  .setDescription('Disable bot update channels (admin only).')
  .addSubcommand((sc) =>
    sc
      .setName('leaderboard')
      .setDescription('Disable a leaderboard board')
      .addStringOption((o) =>
        o.setName('game').setDescription('Choose one game or All games').setAutocomplete(true).setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName('delete_message').setDescription('Delete the existing leaderboard message if possible'),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('card')
      .setDescription('Disable match cards')
      .addStringOption((o) =>
        o.setName('game').setDescription('Choose one game or All games').setAutocomplete(true).setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName('delete_messages').setDescription('Delete existing card messages if possible'),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('voice')
      .setDescription('Disable automatic voice channel renaming')
      .addStringOption((o) =>
        o.setName('game').setDescription('Choose one game or All games').setAutocomplete(true).setRequired(true),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  await interaction.respond(searchGames(interaction.options.getFocused(), { includeAll: true }));
}

async function deleteMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  await message.delete().catch(() => {});
  return true;
}

function selectedScope(interaction) {
  const selected = normalizeGameSlug(interaction.options.getString('game', true));
  return selected === ALL_GAMES ? null : selected;
}

function labelFor(game, kind) {
  return game ? `${gameName(game)} ${kind}` : `All-games ${kind}`;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const game = selectedScope(interaction);

  if (sub === 'leaderboard') {
    const shouldDelete = interaction.options.getBoolean('delete_message') ?? true;
    let deleted = false;
    if (game) {
      const board = getGameLeaderboards(interaction.guildId).find((row) => row.game === game);
      if (shouldDelete && board) deleted = await deleteMessage(interaction.client, board.channel_id, board.message_id);
      deleteGameLeaderboard(interaction.guildId, game);
    } else {
      const settings = getSettings(interaction.guildId);
      if (shouldDelete) deleted = await deleteMessage(interaction.client, settings.leaderboard_channel_id, settings.leaderboard_message_id);
      clearCombinedLeaderboard(interaction.guildId);
    }

    const label = labelFor(game, 'leaderboard');
    await interaction.reply({
      content: `Disabled **${label}**.${deleted ? ' The existing message was deleted.' : ''}`,
      flags: MessageFlags.Ephemeral,
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'Leaderboard Channel Disabled',
      actor: interaction.user,
      target: label,
      details: `Game scope: ${game || 'all games'}\nDeleted message: ${deleted ? 'yes' : 'no'}`,
      color: 'danger',
    });
    return;
  }

  if (sub === 'card') {
    const shouldDelete = interaction.options.getBoolean('delete_messages') ?? true;
    const key = game || ALL_GAMES;
    let deleted = 0;
    if (shouldDelete) {
      for (const row of getMatchCardMessages(interaction.guildId, key)) {
        if (await deleteMessage(interaction.client, row.channel_id, row.message_id)) deleted++;
      }
    }
    clearMatchCardMessages(interaction.guildId, key);
    deleteGameMatchCard(interaction.guildId, key);

    const label = labelFor(game, 'match cards');
    await interaction.reply({
      content: `Disabled **${label}**.${deleted ? ` Deleted ${deleted} existing message(s).` : ''}`,
      flags: MessageFlags.Ephemeral,
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'Match Cards Disabled',
      actor: interaction.user,
      target: label,
      details: `Game scope: ${game || 'all games'}\nDeleted messages: ${deleted}`,
      color: 'danger',
    });
    return;
  }

  if (sub === 'voice') {
    if (game) deleteGameVoiceChannel(interaction.guildId, game);
    else clearCombinedVoiceChannel(interaction.guildId);

    const label = labelFor(game, 'voice channel');
    await interaction.reply({
      content: `Disabled **${label}** automatic renaming.`,
      flags: MessageFlags.Ephemeral,
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'Voice Status Channel Disabled',
      actor: interaction.user,
      target: label,
      details: `Game scope: ${game || 'all games'}`,
      color: 'danger',
    });
  }
}
