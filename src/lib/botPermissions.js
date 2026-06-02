import { PermissionFlagsBits } from 'discord.js';

const LABELS = new Map([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.AttachFiles, 'Attach Files'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
]);

export const EMBED_BOARD_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
];

export const IMAGE_BOARD_PERMISSIONS = [
  ...EMBED_BOARD_PERMISSIONS,
  PermissionFlagsBits.AttachFiles,
];

export const VOICE_STATUS_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
];

export function missingBotChannelPermissions(interaction, channel, permissions) {
  const member = interaction.guild?.members?.me ?? interaction.client.user;
  const available = channel.permissionsFor(member);
  if (!available) return permissions.map((permission) => LABELS.get(permission) ?? String(permission));

  return permissions
    .filter((permission) => !available.has(permission))
    .map((permission) => LABELS.get(permission) ?? String(permission));
}

export function botChannelPermissionMessage(channel, missing) {
  return [
    `I can't use ${channel} yet.`,
    `Missing bot permission${missing.length === 1 ? '' : 's'}: **${missing.join('**, **')}**.`,
    'Please update the channel or category permissions, then run the command again.',
  ].join('\n');
}
