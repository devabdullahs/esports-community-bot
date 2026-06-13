import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { setChannel, setEwcNewsChannel, setGameLeaderboard, setGameMatchCard, setGameVoiceChannel } from '../db/settings.js';
import { updateLeaderboard } from '../jobs/leaderboard.js';
import { updateVoiceChannel } from '../jobs/voiceStatus.js';
import { ALL_GAMES, updateMatchCards } from '../jobs/matchCardBoard.js';
import { normalizeGameSlug, searchGames, gameName } from '../lib/games.js';
import { sendAuditLog } from '../lib/auditLog.js';
import {
  botChannelPermissionMessage,
  EMBED_BOARD_PERMISSIONS,
  IMAGE_BOARD_PERMISSIONS,
  missingBotChannelPermissions,
  VOICE_STATUS_PERMISSIONS,
} from '../lib/botPermissions.js';

export const data = new SlashCommandBuilder()
  .setName('set_channel')
  .setDescription('Configure where the bot posts updates (admin only).')
  .addSubcommand((sc) =>
    sc
      .setName('leaderboard')
      .setDescription('Channel for a live, auto-updating leaderboard (all games, or one game)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Choose one game or All games')
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('voice')
      .setDescription('Voice channel whose name shows live match status (all games, or one game)')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Choose one game or All games')
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('card')
      .setDescription('Channel for auto-updating live match image cards (all games, or one game)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Choose one game or All games')
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('news')
      .setDescription('Default channel for auto-posted news (used when a game has no dedicated channel)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  await interaction.respond(searchGames(interaction.options.getFocused(), { includeAll: true }));
}

function confirm(label, channel, note) {
  return new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addTextDisplayComponents((td) => td.setContent(`✅ **${label} set** to ${channel}.\n${note}`));
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const channel = interaction.options.getChannel('channel', true);

  if (sub === 'voice') {
    const missing = missingBotChannelPermissions(interaction, channel, VOICE_STATUS_PERMISSIONS);
    if (missing.length) {
      await interaction.reply({
        content: botChannelPermissionMessage(channel, missing),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectedGame = normalizeGameSlug(interaction.options.getString('game', true));
    const game = selectedGame === ALL_GAMES ? null : selectedGame;
    if (game) await setGameVoiceChannel(interaction.guildId, game, channel.id);
    else await setChannel(interaction.guildId, 'voice_channel_id', channel.id);
    const label = game ? `${gameName(game)} voice channel` : 'Live voice channel';
    await interaction.reply({
      components: [
        confirm(label, channel, '-# Its name reflects live match status (renamed sparingly to respect Discord limits).'),
      ],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'Voice Status Channel Set',
      actor: interaction.user,
      target: `${label}: ${channel} (${channel.id})`,
      details: `Game scope: ${game || 'all games'}`,
      color: 'config',
    });
    await updateVoiceChannel(interaction.client, interaction.guildId).catch(() => {});
    return;
  }

  if (sub === 'card') {
    const missing = missingBotChannelPermissions(interaction, channel, IMAGE_BOARD_PERMISSIONS);
    if (missing.length) {
      await interaction.reply({
        content: botChannelPermissionMessage(channel, missing),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectedGame = normalizeGameSlug(interaction.options.getString('game', true));
    const game = selectedGame === ALL_GAMES ? ALL_GAMES : selectedGame;
    await setGameMatchCard(interaction.guildId, game, channel.id);
    const label = game === ALL_GAMES ? 'All-games match cards' : `${gameName(game)} match cards`;
    await interaction.reply({
      components: [
        confirm(label, channel, '-# One image is posted per running match; finished match cards are removed.'),
      ],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'Match Card Channel Set',
      actor: interaction.user,
      target: `${label}: ${channel} (${channel.id})`,
      details: `Game scope: ${game === ALL_GAMES ? 'all games' : game}`,
      color: 'config',
    });
    await updateMatchCards(interaction.client, interaction.guildId).catch(() => {});
    return;
  }

  if (sub === 'news') {
    const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
    if (missing.length) {
      await interaction.reply({
        content: botChannelPermissionMessage(channel, missing),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setEwcNewsChannel(interaction.guildId, channel.id);
    await interaction.reply({
      components: [
        confirm(
          'Default news channel',
          channel,
          '-# Published news posts land here unless a game has its own channel set in the dashboard.',
        ),
      ],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'News Channel Set',
      actor: interaction.user,
      target: `Default news channel: ${channel} (${channel.id})`,
      details: 'Fallback for games without a dedicated Discord news channel.',
      color: 'config',
    });
    return;
  }

  // leaderboard (combined or per-game)
  const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
  if (missing.length) {
    await interaction.reply({
      content: botChannelPermissionMessage(channel, missing),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedGame = normalizeGameSlug(interaction.options.getString('game', true));
  const game = selectedGame === ALL_GAMES ? null : selectedGame;
  if (game) await setGameLeaderboard(interaction.guildId, game, channel.id);
  else await setChannel(interaction.guildId, 'leaderboard_channel_id', channel.id);

  const label = game ? `${gameName(game)} leaderboard` : 'Combined leaderboard';
  await interaction.reply({
    components: [confirm(label, channel, '-# The live scoreboard appears here and updates automatically.')],
    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
  });
  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Leaderboard Channel Set',
    actor: interaction.user,
    target: `${label}: ${channel} (${channel.id})`,
    details: `Game scope: ${game || 'all games'}`,
    color: 'config',
  });
  await updateLeaderboard(interaction.client, interaction.guildId).catch(() => {});
}
