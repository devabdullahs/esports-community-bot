import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { getSettings, setCsRankings } from '../db/settings.js';
import { buildCsRankingsEmbed, buildCsRankingsImagePayload, updateCsRankings } from '../jobs/csRankings.js';
import { fetchValveRegionalStandings } from '../services/liquipedia.js';
import { sendAuditLog } from '../lib/auditLog.js';
import {
  botChannelPermissionMessage,
  EMBED_BOARD_PERMISSIONS,
  IMAGE_BOARD_PERMISSIONS,
  missingBotChannelPermissions,
} from '../lib/botPermissions.js';

const REGIONS = [
  ['global', 'Global'],
  ['europe', 'Europe'],
  ['americas', 'Americas'],
  ['asia', 'Asia'],
];

export const data = new SlashCommandBuilder()
  .setName('set_cs_rankings')
  .setDescription('Manage the auto-updating Counter-Strike Valve rankings board.')
  .addSubcommand((sc) =>
    sc
      .setName('set')
      .setDescription('Set or move the rankings board')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel for the rankings board')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('region')
          .setDescription('Ranking region')
          .setRequired(true)
          .addChoices(...REGIONS.map(([value, name]) => ({ name, value }))),
      )
      .addStringOption((o) =>
        o
          .setName('format')
          .setDescription('How to display the rankings')
          .setRequired(false)
          .addChoices({ name: 'Embed', value: 'embed' }, { name: 'Image card', value: 'image' }),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('post')
      .setDescription('Post the latest rankings once without auto-updating')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel to post the one-time rankings')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('region')
          .setDescription('Ranking region')
          .setRequired(true)
          .addChoices(...REGIONS.map(([value, name]) => ({ name, value }))),
      )
      .addStringOption((o) =>
        o
          .setName('format')
          .setDescription('How to display the rankings')
          .addChoices({ name: 'Embed', value: 'embed' }, { name: 'Image card', value: 'image' }),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName('refresh').setDescription('Refresh the current rankings board message now'),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const current = await getSettings(interaction.guildId);
  const channel = interaction.options.getChannel('channel') || null;
  const region = interaction.options.getString('region') || current.cs_rankings_region || 'global';
  const format = interaction.options.getString('format') || current.cs_rankings_format || 'embed';
  const regionLabel = REGIONS.find(([value]) => value === region)?.[1] || region;

  if (sub === 'post') {
    const missing = missingBotChannelPermissions(
      interaction,
      channel,
      format === 'image' ? IMAGE_BOARD_PERMISSIONS : EMBED_BOARD_PERMISSIONS,
    );
    if (missing.length) {
      await interaction.reply({
        content: botChannelPermissionMessage(channel, missing),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const data = await fetchValveRegionalStandings(region);
    const payload =
      format === 'image' ? await buildCsRankingsImagePayload(data) : { embeds: [buildCsRankingsEmbed(data)], files: [] };
    await channel.send(payload);
    await interaction.editReply({
      content: `Posted the latest Counter-Strike Valve rankings for **${regionLabel}** in ${channel}.`,
    });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'CS Rankings Posted Once',
      actor: interaction.user,
      target: `${channel} (${channel.id})`,
      details: `Region: ${regionLabel}\nFormat: ${format}`,
      color: 'config',
    });
    return;
  }

  if (sub === 'refresh') {
    if (!current.cs_rankings_channel_id) {
      await interaction.reply({
        content:
          'No auto-updating CS rankings board is configured yet. `/set_cs_rankings post` posts once only; use `/set_cs_rankings set` if you want a board that can be refreshed.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const savedChannel = await interaction.client.channels.fetch(current.cs_rankings_channel_id).catch(() => null);
    if (!savedChannel?.isTextBased?.()) {
      await interaction.reply({
        content: 'The saved CS rankings channel is no longer available. Use `/set_cs_rankings set` to choose a new channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const missing = missingBotChannelPermissions(
      interaction,
      savedChannel,
      (current.cs_rankings_format || 'embed') === 'image' ? IMAGE_BOARD_PERMISSIONS : EMBED_BOARD_PERMISSIONS,
    );
    if (missing.length) {
      await interaction.reply({
        content: botChannelPermissionMessage(savedChannel, missing),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({ content: 'Refreshing the CS rankings board now.', flags: MessageFlags.Ephemeral });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'CS Rankings Refreshed',
      actor: interaction.user,
      target: `<#${current.cs_rankings_channel_id}> (${current.cs_rankings_channel_id})`,
      details: `Region: ${current.cs_rankings_region || 'global'}\nFormat: ${current.cs_rankings_format || 'embed'}`,
      color: 'config',
    });
    await updateCsRankings(interaction.client, interaction.guildId);
    return;
  }

  const targetChannel =
    channel ||
    (current.cs_rankings_channel_id ? await interaction.client.channels.fetch(current.cs_rankings_channel_id).catch(() => null) : null);
  if (!targetChannel?.isTextBased?.()) {
    await interaction.reply({
      content: 'Choose a channel, or set a CS rankings channel first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const missing = missingBotChannelPermissions(
    interaction,
    targetChannel,
    format === 'image' ? IMAGE_BOARD_PERMISSIONS : EMBED_BOARD_PERMISSIONS,
  );
  if (missing.length) {
    await interaction.reply({
      content: botChannelPermissionMessage(targetChannel, missing),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await setCsRankings(interaction.guildId, { channelId: targetChannel.id, region, format });

  await interaction.reply({
    content: `Setting Counter-Strike Valve rankings to **${regionLabel}** in ${targetChannel} as ${format === 'image' ? 'an image card' : 'an embed'}.`,
    flags: MessageFlags.Ephemeral,
  });

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'CS Rankings Channel Set',
    actor: interaction.user,
    target: `${targetChannel} (${targetChannel.id})`,
    details: `Region: ${regionLabel}\nFormat: ${format}`,
    color: 'config',
  });

  await updateCsRankings(interaction.client, interaction.guildId);
}
