import { EmbedBuilder } from 'discord.js';
import { getSettings } from '../db/settings.js';

const COLORS = {
  success: 0x57f287,
  danger: 0xed4245,
  config: 0x5865f2,
};

function clean(value, fallback = 'Unknown') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function actorText(user) {
  if (!user) return 'Unknown';
  return `${user.tag || user.username || user.id} (${user.id})`;
}

export async function sendAuditLog(client, guildId, { action, actor, target, details, color = 'config' }) {
  const channelId = getSettings(guildId).audit_log_channel_id;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS[color] ?? COLORS.config)
    .setTitle(clean(action, 'Audit event'))
    .addFields({ name: 'Actor', value: actorText(actor), inline: false })
    .setTimestamp(new Date());

  if (target) embed.addFields({ name: 'Target', value: clean(target).slice(0, 1024), inline: false });
  if (details) embed.addFields({ name: 'Details', value: clean(details).slice(0, 1024), inline: false });

  await channel.send({ embeds: [embed] }).catch(() => {});
}
