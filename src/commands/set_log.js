import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { setAuditLogChannel } from '../db/settings.js';
import { sendAuditLog } from '../lib/auditLog.js';
import {
  botChannelPermissionMessage,
  EMBED_BOARD_PERMISSIONS,
  missingBotChannelPermissions,
} from '../lib/botPermissions.js';

export const data = new SlashCommandBuilder()
  .setName('set_log')
  .setDescription('Set the admin audit log channel.')
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Text or announcement channel for bot admin audit logs')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
  if (missing.length) {
    await interaction.reply({
      content: botChannelPermissionMessage(channel, missing),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await setAuditLogChannel(interaction.guildId, channel.id);

  await interaction.reply({
    content: `✅ Audit logs will be posted in ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Audit Log Channel Set',
    actor: interaction.user,
    target: `${channel} (${channel.id})`,
    details: 'Bot admin actions will be logged here.',
    color: 'config',
  });
}
