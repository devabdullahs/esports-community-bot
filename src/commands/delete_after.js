import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { sendAuditLog } from '../lib/auditLog.js';

const COMMAND_NAME = 'Delete After';
const MAX_DELETE_MESSAGES = 1000;
const BULK_DELETE_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000 - 60_000;
const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
];

export const data = new ContextMenuCommandBuilder()
  .setName(COMMAND_NAME)
  .setType(ApplicationCommandType.Message)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setContexts(InteractionContextType.Guild);

function snowflakeValue(id) {
  return BigInt(String(id));
}

function isNewerSnowflake(id, anchorId) {
  return snowflakeValue(id) > snowflakeValue(anchorId);
}

function compareSnowflakeDesc(a, b) {
  const av = snowflakeValue(a);
  const bv = snowflakeValue(b);
  if (av === bv) return 0;
  return av > bv ? -1 : 1;
}

function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function missingPermissionNames(permissions, required) {
  const labels = new Map([
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
    [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  ]);

  return required.filter((permission) => !permissions?.has?.(permission)).map((permission) => labels.get(permission) ?? String(permission));
}

function hasMessageHistory(channel) {
  return Boolean(channel?.messages?.fetch);
}

function confirmationCustomId(interaction, targetMessage, count) {
  return `${COMMAND_NAME}:confirm:${interaction.user.id}:${interaction.channelId}:${targetMessage.id}:${count}`;
}

function cancelCustomId(interaction) {
  return `${COMMAND_NAME}:cancel:${interaction.user.id}`;
}

function confirmationComponents(interaction, targetMessage, count) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmationCustomId(interaction, targetMessage, count))
        .setLabel(`Delete ${plural(count, 'message')}`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelCustomId(interaction)).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function previewContent(interaction, targetMessage, summary) {
  const selectedLink = messageLink(interaction.guildId, interaction.channelId, targetMessage.id);
  const lines = [
    '**Confirm message cleanup**',
    `This will delete **${plural(summary.count, 'message')}** posted after the [selected message](${selectedLink}) in <#${interaction.channelId}>.`,
  ];

  if (summary.pinnedCount > 0) lines.push(`Pinned messages included: **${summary.pinnedCount.toLocaleString()}**.`);
  if (summary.oldCount > 0) lines.push(`Older-than-14-days messages included: **${summary.oldCount.toLocaleString()}**. They will be deleted individually.`);

  lines.push('This cannot be undone. Confirm only if every newer message in this channel should be removed.');
  return lines.join('\n');
}

function tooManyContent(count) {
  return [
    '**Cleanup is too large**',
    `I found more than ${MAX_DELETE_MESSAGES.toLocaleString()} messages after the selected message.`,
    `For safety, select a newer message or split the cleanup into batches of ${MAX_DELETE_MESSAGES.toLocaleString()} messages or fewer.`,
    `Counted before stopping: **${count.toLocaleString()}**.`,
  ].join('\n');
}

async function ensureCanUse(interaction) {
  if (!interaction.inGuild?.()) {
    await interaction.reply({ content: 'This message app can only be used inside the server.', flags: MessageFlags.Ephemeral });
    return null;
  }

  if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: 'You need **Manage Messages** to use this message app.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const channel = interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId).catch(() => null));
  if (!hasMessageHistory(channel)) {
    await interaction.reply({ content: 'I cannot read message history in this channel.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const missing = missingPermissionNames(interaction.appPermissions, REQUIRED_BOT_PERMISSIONS);
  if (missing.length) {
    await interaction.reply({
      content: `I need **${missing.join('**, **')}** in <#${interaction.channelId}> before I can clean up messages here.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return channel;
}

async function ensureCanUseAfterDefer(interaction) {
  if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages)) {
    await interaction.editReply({ content: 'You need **Manage Messages** to use this message app.', components: [] });
    return null;
  }

  const channel = interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId).catch(() => null));
  if (!hasMessageHistory(channel)) {
    await interaction.editReply({ content: 'I cannot read message history in this channel.', components: [] });
    return null;
  }

  const missing = missingPermissionNames(interaction.appPermissions, REQUIRED_BOT_PERMISSIONS);
  if (missing.length) {
    await interaction.editReply({
      content: `I need **${missing.join('**, **')}** in <#${interaction.channelId}> before I can clean up messages here.`,
      components: [],
    });
    return null;
  }

  return channel;
}

export async function collectMessagesAfter(channel, anchorId, { maxMessages = MAX_DELETE_MESSAGES } = {}) {
  const messages = [];
  let before;

  for (;;) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options);
    if (!batch?.size) return { messages, truncated: false };

    const page = [...batch.values()].sort((a, b) => compareSnowflakeDesc(a.id, b.id));
    for (const message of page) {
      if (!isNewerSnowflake(message.id, anchorId)) return { messages, truncated: false };

      messages.push(message);
      if (messages.length > maxMessages) {
        return { messages: messages.slice(0, maxMessages), truncated: true, counted: messages.length };
      }
    }

    const oldest = page.at(-1);
    if (!oldest || !isNewerSnowflake(oldest.id, anchorId)) return { messages, truncated: false };
    before = oldest.id;
  }
}

function summarizeMessages(messages) {
  const oldCutoff = Date.now() - BULK_DELETE_CUTOFF_MS;
  return {
    count: messages.length,
    pinnedCount: messages.filter((message) => message.pinned).length,
    oldCount: messages.filter((message) => Number(message.createdTimestamp ?? Date.now()) <= oldCutoff).length,
  };
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export async function deleteCollectedMessages(channel, messages) {
  const recent = [];
  const old = [];
  const oldCutoff = Date.now() - BULK_DELETE_CUTOFF_MS;

  for (const message of messages) {
    if (Number(message.createdTimestamp ?? Date.now()) > oldCutoff) recent.push(message);
    else old.push(message);
  }

  let deleted = 0;
  let failed = 0;

  for (const group of chunk(recent, 100)) {
    if (group.length >= 2 && typeof channel.bulkDelete === 'function') {
      try {
        const result = await channel.bulkDelete(group, true);
        const deletedCount = result?.size ?? 0;
        deleted += deletedCount;
        failed += group.length - deletedCount;
        continue;
      } catch {
        // Fall back to individual deletes below.
      }
    }

    for (const message of group) {
      try {
        await message.delete();
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
  }

  for (const message of old) {
    try {
      await message.delete();
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return { deleted, failed };
}

export async function execute(interaction) {
  const channel = await ensureCanUse(interaction);
  if (!channel) return;

  const targetMessage = interaction.targetMessage;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await collectMessagesAfter(channel, targetMessage.id);
  if (result.truncated) {
    await interaction.editReply({ content: tooManyContent(result.counted ?? result.messages.length), components: [] });
    return;
  }

  const summary = summarizeMessages(result.messages);
  if (summary.count === 0) {
    await interaction.editReply({
      content: `There are no messages after the [selected message](${messageLink(interaction.guildId, interaction.channelId, targetMessage.id)}) in <#${interaction.channelId}>.`,
      components: [],
    });
    return;
  }

  await interaction.editReply({
    content: previewContent(interaction, targetMessage, summary),
    components: confirmationComponents(interaction, targetMessage, summary.count),
  });
}

export async function handleComponent(interaction) {
  const [, action, userId, channelId, messageId, expectedCountRaw] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Only the moderator who opened this confirmation can use these buttons.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'cancel') {
    await interaction.update({ content: 'Cleanup cancelled. No messages were deleted.', components: [] });
    return;
  }

  if (action !== 'confirm') return;

  await interaction.deferUpdate();

  if (channelId !== interaction.channelId) {
    await interaction.editReply({ content: 'This confirmation no longer matches the current channel. No messages were deleted.', components: [] });
    return;
  }

  const channel = await ensureCanUseAfterDefer(interaction);
  if (!channel) return;

  const result = await collectMessagesAfter(channel, messageId);
  if (result.truncated) {
    await interaction.editReply({ content: tooManyContent(result.counted ?? result.messages.length), components: [] });
    return;
  }

  const summary = summarizeMessages(result.messages);
  const expectedCount = Number(expectedCountRaw);
  if (summary.count !== expectedCount) {
    const targetMessage = { id: messageId };
    await interaction.editReply({
      content: [
        '**Channel changed before confirmation**',
        `The cleanup count is now **${plural(summary.count, 'message')}** instead of **${plural(expectedCount, 'message')}**.`,
        'Review the updated count, then confirm again if it is still correct.',
        '',
        previewContent(interaction, targetMessage, summary),
      ].join('\n'),
      components: summary.count > 0 ? confirmationComponents(interaction, targetMessage, summary.count) : [],
    });
    return;
  }

  if (summary.count === 0) {
    await interaction.editReply({ content: 'There are no messages left to delete after the selected message.', components: [] });
    return;
  }

  const outcome = await deleteCollectedMessages(channel, result.messages);
  const failedText = outcome.failed > 0 ? ` ${plural(outcome.failed, 'message')} could not be deleted.` : '';
  await interaction.editReply({
    content: `Deleted **${plural(outcome.deleted, 'message')}** after the selected message in <#${interaction.channelId}>.${failedText}`,
    components: [],
  });

  await sendAuditLog(interaction.client, interaction.guildId, {
    action: 'Messages Deleted After',
    actor: interaction.user,
    target: `<#${interaction.channelId}> (${interaction.channelId})`,
    details:
      `Selected message: ${messageLink(interaction.guildId, interaction.channelId, messageId)}\n` +
      `Deleted: ${outcome.deleted.toLocaleString()}\n` +
      `Failed: ${outcome.failed.toLocaleString()}`,
    color: 'danger',
  });
}
