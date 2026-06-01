import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { setChannel, setGameLeaderboard, setGameVoiceChannel } from '../db/settings.js';
import { updateLeaderboard } from '../jobs/leaderboard.js';
import { updateVoiceChannel } from '../jobs/voiceStatus.js';
import { searchGames, gameName } from '../lib/games.js';

export const data = new SlashCommandBuilder()
  .setName('set_channel')
  .setDescription('Configure where the bot posts updates (admin only).')
  .addSubcommand((sc) =>
    sc
      .setName('leaderboard')
      .setDescription('Channel for a live, auto-updating leaderboard (all games, or one game)')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('game')
          .setDescription('Optional: limit this board to one game (leave empty for an all-games board)')
          .setAutocomplete(true),
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
          .setDescription('Optional: base this channel on one game (leave empty for all games)')
          .setAutocomplete(true),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

export async function autocomplete(interaction) {
  await interaction.respond(searchGames(interaction.options.getFocused()));
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
    const game = interaction.options.getString('game');
    if (game) setGameVoiceChannel(interaction.guildId, game, channel.id);
    else setChannel(interaction.guildId, 'voice_channel_id', channel.id);
    const label = game ? `${gameName(game)} voice channel` : 'Live voice channel';
    await interaction.reply({
      components: [
        confirm(label, channel, '-# Its name reflects live match status (renamed sparingly to respect Discord limits).'),
      ],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
    await updateVoiceChannel(interaction.client, interaction.guildId).catch(() => {});
    return;
  }

  // leaderboard (combined or per-game)
  const game = interaction.options.getString('game');
  if (game) setGameLeaderboard(interaction.guildId, game, channel.id);
  else setChannel(interaction.guildId, 'leaderboard_channel_id', channel.id);

  const label = game ? `${gameName(game)} leaderboard` : 'Combined leaderboard';
  await interaction.reply({
    components: [confirm(label, channel, '-# The live scoreboard appears here and updates automatically.')],
    flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
  });
  await updateLeaderboard(interaction.client, interaction.guildId).catch(() => {});
}
