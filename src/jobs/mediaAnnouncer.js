import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.js';
import { getEwcGame } from '../db/ewcGames.js';
import { getEwcMediaChannel } from '../db/ewcMediaChannels.js';
import {
  deleteMediaDiscordPost,
  listMediaDiscordPosts,
  listUnpostedAnnounceableMediaChannels,
  recordMediaDiscordPost,
  touchMediaDiscordPost,
} from '../db/ewcMediaDiscordPosts.js';
import {
  clampText,
  prepareBodyForDiscord,
  DISCORD_FOOTER_CAP,
  DISCORD_TITLE_CAP,
} from '../lib/discordContent.js';
import { logger } from '../lib/logger.js';

// Auto-announces media channels to Discord. Unlike news, this is OPT-IN: a channel is
// only posted once an admin sets its Discord channel id (so the pre-seeded directory does
// not suddenly spam). Lifecycle mirrors the news announcer — post once, edit on update,
// remove when the admin clears the channel id or deletes the entry, move when retargeted.

const PLATFORM_LABELS = {
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitch: 'Twitch',
  website: 'Website',
};

function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function pickLocale(localized) {
  if (!localized || typeof localized !== 'object') return '';
  return localized.ar || localized.en || '';
}

function dashboardUrl(slug) {
  const publicUrl = config.dashboard.publicUrl;
  if (!publicUrl) return null;
  const url = `${publicUrl.replace(/\/$/, '')}/media/${slug}`;
  return isSafeHttpUrl(url) ? url : null;
}

function buildMediaPayload(channel, game = null) {
  const name = clampText(pickLocale(channel.name) || channel.slug, DISCORD_TITLE_CAP);
  const description = prepareBodyForDiscord(pickLocale(channel.description), 2048);
  const viewUrl = dashboardUrl(channel.slug);

  const embed = new EmbedBuilder().setColor(0xe11d48).setTitle(name);
  if (viewUrl) embed.setURL(viewUrl);
  if (description) embed.setDescription(description);
  if (isSafeHttpUrl(channel.logoUrl)) embed.setThumbnail(channel.logoUrl);

  const gameName = game?.title?.ar || game?.title?.en || null;
  if (gameName) embed.setFooter({ text: clampText(gameName, DISCORD_FOOTER_CAP) });

  // Link buttons: the channel's own links (up to 4) plus a dashboard button, all in
  // one action row (Discord allows 5 link buttons per row).
  const buttons = [];
  const links = Array.isArray(channel.links) ? channel.links : [];
  for (const link of links) {
    if (buttons.length >= 4) break;
    if (!isSafeHttpUrl(link?.url)) continue;
    const label = PLATFORM_LABELS[link.platform] || 'Link';
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(link.url));
  }
  if (viewUrl) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View on dashboard').setURL(viewUrl));
  }

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (buttons.length) payload.components = [new ActionRowBuilder().addComponents(...buttons)];
  return payload;
}

async function resolveTarget(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const guildId = channel.guildId || channel.guild?.id || client.guilds.cache.first()?.id || null;
  return { channel, guildId };
}

async function postNewAnnounceable(client) {
  for (const row of await listUnpostedAnnounceableMediaChannels()) {
    try {
      const resolved = await resolveTarget(client, row.discord_channel_id);
      if (!resolved) {
        logger.debug(`[media] no channel resolved for ${row.slug} (${row.discord_channel_id}); skipping`);
        continue;
      }
      const channel = await getEwcMediaChannel(row.slug);
      if (!channel) continue;
      const game = row.game_slug ? await getEwcGame(row.game_slug) : null;
      const sent = await resolved.channel.send(buildMediaPayload(channel, game));
      await recordMediaDiscordPost(row.slug, {
        guildId: resolved.guildId,
        channelId: resolved.channel.id,
        messageId: sent.id,
      });
      logger.info(`[media] posted ${row.slug} as message ${sent.id} in channel ${resolved.channel.id}`);
    } catch (error) {
      logger.warn(`[media] failed to post ${row.slug}: ${error.message}`);
    }
  }
}

async function deleteMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) await message.delete().catch((e) => logger.warn(`[media] delete failed: ${e.message}`));
}

async function syncExisting(client) {
  for (const row of await listMediaDiscordPosts()) {
    try {
      // Admin cleared the channel id (opt-out): remove the message and the row.
      if (!row.discord_channel_id) {
        await deleteMessage(client, row.channel_id, row.message_id);
        await deleteMediaDiscordPost(row.slug);
        logger.info(`[media] removed announcement for opted-out ${row.slug}`);
        continue;
      }

      // Admin retargeted to a different channel: drop the old message+row so the next
      // tick re-posts into the new channel.
      if (row.channel_id !== row.discord_channel_id) {
        await deleteMessage(client, row.channel_id, row.message_id);
        await deleteMediaDiscordPost(row.slug);
        logger.info(`[media] ${row.slug} retargeted; will re-post to ${row.discord_channel_id}`);
        continue;
      }

      // Still on the same channel: edit if the entry changed since we last posted.
      if (row.updated_at && row.posted_at && row.updated_at > row.posted_at) {
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (!channel?.isTextBased?.()) continue;
        const message = await channel.messages.fetch(row.message_id).catch(() => null);
        if (!message) {
          // Self-heal: message manually deleted. Drop the row so the next tick re-posts.
          await deleteMediaDiscordPost(row.slug);
          logger.warn(`[media] message for ${row.slug} is gone; re-posting next tick`);
          continue;
        }
        const mediaChannel = await getEwcMediaChannel(row.slug);
        if (!mediaChannel) continue;
        const game = row.game_slug ? await getEwcGame(row.game_slug) : null;
        await message.edit(buildMediaPayload(mediaChannel, game));
        await touchMediaDiscordPost(row.slug);
        logger.info(`[media] edited announcement for ${row.slug}`);
      }
    } catch (error) {
      logger.warn(`[media] failed to sync ${row.slug}: ${error.message}`);
    }
  }
}

export async function runMediaAnnouncer(client = null) {
  if (!client) return;
  // Edits/removals first so corrections land before fresh posts in the same tick.
  await syncExisting(client);
  await postNewAnnounceable(client);
}

let timer = null;
let running = false;

export function startMediaAnnouncer(client) {
  const intervalMs = Math.max(30_000, config.ewcNews.announceIntervalMs);
  const run = async () => {
    if (running) {
      logger.debug('[media] previous announcer run still active; skipping this tick');
      return;
    }
    running = true;
    try {
      await runMediaAnnouncer(client);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => run().catch((e) => logger.error(`[media] ${e.message}`)), intervalMs);
  timer.unref?.();
  logger.info(`[media] announcer check every ${Math.round(intervalMs / 1000)}s.`);
  run().catch((e) => logger.error(`[media] ${e.message}`));
}

export function stopMediaAnnouncer() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
