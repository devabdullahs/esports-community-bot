import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { setCostreamAnnounceChannel } from '../db/settings.js';
import { sendAuditLog } from '../lib/auditLog.js';

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
  await setCostreamAnnounceChannel(interaction.guildId, channel.id);
  await interaction.reply({
    content:
      `✅ Co-stream go-live announcements set to ${channel}.\n` +
      '-# Posts once when a tracked co-streamer goes live on Twitch, Kick, or YouTube (30 min re-announce cooldown).',
    flags: MessageFlags.Ephemeral,
  });
  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Co-stream Announcements Set',
    actor: interaction.user,
    details: `Channel: #${channel.name} (${channel.id})`,
  });
}
