import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { setCostreamAnnounceChannel } from '../db/settings.js';
import { sendAuditLog } from '../lib/auditLog.js';
import {
  botChannelPermissionMessage,
  EMBED_BOARD_PERMISSIONS,
  missingBotChannelPermissions,
} from '../lib/botPermissions.js';

// Configure "co-streamer went live" announcements. The stream-status poller
// detects offline -> live transitions on tracked Twitch/Kick/YouTube channels
// and posts one embed per go-live in the configured channel.
export const data = new SlashCommandBuilder()
  .setName('set_costreams')
  .setDescription('Configure co-stream go-live announcements (admin only).')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((sc) =>
    sc
      .setName('announcements')
      .setDescription('Channel where "co-streamer is live" announcements are posted')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text or announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o
          .setName('mention_role')
          .setDescription('Optional role to mention when a tracked co-streamer goes live')
          .setRequired(false),
      ),
  )
  .addSubcommand((sc) => sc.setName('off').setDescription('Turn go-live announcements off'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'off') {
    await setCostreamAnnounceChannel(interaction.guildId, null);
    await interaction.reply({ content: '✅ Co-stream go-live announcements turned **off**.', flags: MessageFlags.Ephemeral });
    await sendAuditLog(interaction.client, interaction.guildId, {
      action: 'Co-stream Announcements Disabled',
      actor: interaction.user,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const role = interaction.options.getRole('mention_role');
  const missing = missingBotChannelPermissions(interaction, channel, EMBED_BOARD_PERMISSIONS);
  if (missing.length) {
    await interaction.reply({ content: botChannelPermissionMessage(channel, missing), flags: MessageFlags.Ephemeral });
    return;
  }

  if (role?.id === interaction.guildId) {
    await interaction.reply({ content: 'Please select a server role, not @everyone.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (role?.managed) {
    await interaction.reply({
      content: `${role} is managed by an integration and cannot be used as a mention role.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Security hardening (ECB-SEC-016): the announce role must be mentionable on
  // its own. The bot's Mention Everyone permission is never delegated here —
  // otherwise a moderator could point announcements at a protected,
  // unmentionable role (e.g. staff) and have the bot ping it for them.
  if (role && !role.mentionable) {
    await interaction.reply({
      content:
        `${role} is not mentionable. Make the role mentionable in the server's role settings, then run this command again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await setCostreamAnnounceChannel(interaction.guildId, channel.id, { roleId: role?.id ?? null });
  await interaction.reply({
    content:
      `✅ Co-stream go-live announcements set to ${channel}.\n` +
      `${role ? `-# Mention role: ${role}\n` : ''}` +
      '-# Posts once when a tracked co-streamer goes live on Twitch, Kick, or YouTube (30 min re-announce cooldown).',
    flags: MessageFlags.Ephemeral,
  });
  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Co-stream Announcements Set',
    actor: interaction.user,
    details: `Channel: #${channel.name} (${channel.id})\nMention role: ${role ? `${role.name} (${role.id})` : 'none'}`,
  });
}
