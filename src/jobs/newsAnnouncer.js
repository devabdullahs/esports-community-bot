import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.js';
import { getEwcGame } from '../db/ewcGames.js';
import { getEwcNewsPostById } from '../db/ewcNewsPosts.js';
import { getSettings } from '../db/settings.js';
import {
  deleteDiscordNewsPost,
  listDiscordNewsPosts,
  listUnpostedPublishedNewsPosts,
  recordDiscordNewsPost,
  resolveNewsChannelId,
  touchDiscordNewsPost,
} from '../db/ewcNewsDiscordPosts.js';
import { getTranslationForLocale } from '../lib/ewcNewsContent.js';
import { logger } from '../lib/logger.js';

// Auto-posts published news to Discord. Lifecycle per design doc, with ONE documented v1
// deviation on delete-propagation: ewc_news_discord_posts.post_id has ON DELETE CASCADE, so
// hard-deleting a post removes its row before any tick can observe it. We therefore CANNOT
// clean up the orphaned Discord message for hard-deleted posts in v1 (the message stays).
// Unpublish (status -> draft) keeps the post+row alive, so that path DOES delete the message.
// Acceptable for v1; a future version could soft-capture message ids before deletion.

// Discord embed caps; our content caps (title 90, summary 180) fit comfortably inside these.
const TITLE_CAP = 256;
const DESCRIPTION_CAP = 4096;

function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function clamp(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

// AR primary, EN fallback (community is Arabic-first). getTranslationForLocale already
// falls back: requested -> defaultLocale -> en -> ar -> null.
function buildNewsPayload(post) {
  const translation = getTranslationForLocale(post, 'ar') || getTranslationForLocale(post, 'en');
  const title = clamp(translation?.title || post.title || 'News update', TITLE_CAP);
  const summary = clamp(translation?.summary || post.summary || '', DESCRIPTION_CAP);

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(title);
  if (summary) embed.setDescription(summary);
  if (isSafeHttpUrl(post.coverImageUrl)) embed.setImage(post.coverImageUrl);
  if (post.authorName) embed.setAuthor({ name: clamp(post.authorName, 256) });

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };

  // "Read more" link button only when a public dashboard URL is configured.
  const publicUrl = config.dashboard.publicUrl;
  if (publicUrl) {
    const base = publicUrl.replace(/\/$/, '');
    const url = `${base}/games/${post.gameSlug}/news/${post.id}`;
    if (isSafeHttpUrl(url)) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Read more').setURL(url),
      );
      payload.components = [row];
    }
  }

  return payload;
}

// Single-guild bot: resolve the default news channel + a guild id from the connected guild.
function guildDefaultNewsChannel(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return { guildId: null, channelId: null };
  return { guildId: guild.id, channelId: getSettings(guild.id).ewc_news_channel_id || null };
}

async function resolveChannel(client, gameSlug) {
  const game = getEwcGame(gameSlug);
  const gameChannelId = game?.discordChannelId || null;
  const fallback = guildDefaultNewsChannel(client);
  const channelId = resolveNewsChannelId({ gameChannelId, guildNewsChannelId: fallback.channelId });
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  // Prefer the channel's own guild id; fall back to the connected guild.
  const guildId = channel.guildId || channel.guild?.id || fallback.guildId || null;
  return { channel, guildId };
}

async function postNewPublished(client) {
  for (const { post_id: postId, game_slug: gameSlug } of listUnpostedPublishedNewsPosts()) {
    try {
      const resolved = await resolveChannel(client, gameSlug);
      if (!resolved) {
        logger.debug(`[news] no channel resolved for post ${postId} (${gameSlug}); skipping`);
        continue;
      }
      const post = getEwcNewsPostById(postId);
      if (!post) continue;
      const sent = await resolved.channel.send(buildNewsPayload(post));
      recordDiscordNewsPost(postId, {
        guildId: resolved.guildId,
        channelId: resolved.channel.id,
        messageId: sent.id,
      });
      logger.info(`[news] posted news ${postId} as message ${sent.id} in channel ${resolved.channel.id}`);
    } catch (error) {
      logger.warn(`[news] failed to post news ${postId}: ${error.message}`);
    }
  }
}

async function syncExisting(client) {
  for (const row of listDiscordNewsPosts()) {
    try {
      if (row.status !== 'published') {
        // Unpublished (status back to draft): delete the Discord message and the row.
        // The polling job re-posts if the post is published again later.
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (channel?.isTextBased?.()) {
          const message = await channel.messages.fetch(row.message_id).catch(() => null);
          if (message) await message.delete().catch((e) => logger.warn(`[news] delete failed for ${row.post_id}: ${e.message}`));
        }
        deleteDiscordNewsPost(row.post_id);
        logger.info(`[news] removed Discord message for unpublished news ${row.post_id}`);
        continue;
      }

      // Still published: edit the message if the post was updated after we last posted/edited.
      if (row.updated_at && row.posted_at && row.updated_at > row.posted_at) {
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (!channel?.isTextBased?.()) continue;
        const message = await channel.messages.fetch(row.message_id).catch(() => null);
        if (!message) {
          // Self-heal: the message was manually deleted. Drop the row so the next tick re-posts.
          deleteDiscordNewsPost(row.post_id);
          logger.warn(`[news] message ${row.message_id} for news ${row.post_id} is gone; re-posting next tick`);
          continue;
        }
        const post = getEwcNewsPostById(row.post_id);
        if (!post) continue;
        await message.edit(buildNewsPayload(post));
        touchDiscordNewsPost(row.post_id);
        logger.info(`[news] edited Discord message for news ${row.post_id}`);
      }
    } catch (error) {
      logger.warn(`[news] failed to sync news ${row.post_id}: ${error.message}`);
    }
  }
}

export async function runNewsAnnouncer(client = null) {
  if (!client) return;
  // Unpublishes/edits first so corrections land before any fresh posts in the same tick.
  await syncExisting(client);
  await postNewPublished(client);
}

let timer = null;
let running = false;

export function startNewsAnnouncer(client) {
  const intervalMs = Math.max(30_000, config.ewcNews.announceIntervalMs);
  const run = async () => {
    if (running) {
      logger.debug('[news] previous announcer run still active; skipping this tick');
      return;
    }
    running = true;
    try {
      await runNewsAnnouncer(client);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => run().catch((e) => logger.error(`[news] ${e.message}`)), intervalMs);
  timer.unref?.();
  logger.info(`[news] announcer check every ${Math.round(intervalMs / 1000)}s.`);
  run().catch((e) => logger.error(`[news] ${e.message}`));
}

export function stopNewsAnnouncer() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
