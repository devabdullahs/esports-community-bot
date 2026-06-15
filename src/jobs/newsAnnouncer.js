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
import {
  clampText,
  prepareBodyForDiscord,
  DISCORD_AUTHOR_CAP,
  DISCORD_FOOTER_CAP,
  DISCORD_TITLE_CAP,
} from '../lib/discordContent.js';
import { logger } from '../lib/logger.js';

// Auto-posts published news to Discord. Lifecycle per design doc, with ONE documented v1
// deviation on delete-propagation: ewc_news_discord_posts.post_id has ON DELETE CASCADE, so
// hard-deleting a post removes its row before any tick can observe it. We therefore CANNOT
// clean up the orphaned Discord message for hard-deleted posts in v1 (the message stays).
// Unpublish (status -> draft) keeps the post+row alive, so that path DOES delete the message.
// Acceptable for v1; a future version could soft-capture message ids before deletion.

function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function readMoreUrl(post) {
  const publicUrl = config.dashboard.publicUrl;
  if (!publicUrl) return null;
  const url = `${publicUrl.replace(/\/$/, '')}/games/${post.gameSlug}/news/${post.id}`;
  return isSafeHttpUrl(url) ? url : null;
}

// AR primary, EN fallback (community is Arabic-first). getTranslationForLocale already
// falls back: requested -> defaultLocale -> en -> ar -> null. The embed now carries the
// full article body (capped to Discord's 4096) instead of the short summary, plus the
// byline (avatar + every author), the game, and a publish timestamp so readers get the
// whole post in Discord without opening the site.
function buildNewsPayload(post, game = null) {
  const translation = getTranslationForLocale(post, 'ar') || getTranslationForLocale(post, 'en');
  const title = clampText(translation?.title || post.title || 'News update', DISCORD_TITLE_CAP);
  const body = prepareBodyForDiscord(translation?.body || '');
  const summary = clampText(translation?.summary || post.summary || '', 600);
  // Prefer the body; fall back to the summary for posts that only have a lead.
  const description = body || summary;
  const url = readMoreUrl(post);

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(title);
  if (url) embed.setURL(url);
  if (description) embed.setDescription(description);
  if (isSafeHttpUrl(post.coverImageUrl)) embed.setImage(post.coverImageUrl);

  // Byline: list every author, use the first available avatar as the icon.
  const authors = Array.isArray(post.authors) ? post.authors.filter((a) => a?.name) : [];
  const bylineName = authors.length
    ? authors.map((a) => a.name).join(', ')
    : post.authorName || null;
  if (bylineName) {
    const iconURL = authors.find((a) => isSafeHttpUrl(a.avatarUrl))?.avatarUrl;
    embed.setAuthor({ name: clampText(bylineName, DISCORD_AUTHOR_CAP), ...(iconURL ? { iconURL } : {}) });
  }

  // Footer: the game name (AR-first) so readers see context at a glance.
  const gameName = game?.title?.ar || game?.title?.en || null;
  if (gameName) embed.setFooter({ text: clampText(gameName, DISCORD_FOOTER_CAP) });

  const publishedMs =
    typeof post.publishedAt === 'number'
      ? post.publishedAt * 1000
      : post.publishedAt
        ? Date.parse(`${post.publishedAt}Z`.replace(/Z+$/, 'Z'))
        : NaN;
  if (Number.isFinite(publishedMs)) embed.setTimestamp(publishedMs);

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (url) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Read more').setURL(url),
      ),
    ];
  }
  return payload;
}

// Single-guild bot: resolve the default news channel + a guild id from the connected guild.
async function guildDefaultNewsChannel(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return { guildId: null, channelId: null };
  return { guildId: guild.id, channelId: (await getSettings(guild.id)).ewc_news_channel_id || null };
}

async function resolveChannel(client, gameSlug) {
  const game = await getEwcGame(gameSlug);
  const gameChannelId = game?.discordChannelId || null;
  const fallback = await guildDefaultNewsChannel(client);
  const channelId = resolveNewsChannelId({ gameChannelId, guildNewsChannelId: fallback.channelId });
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  // Prefer the channel's own guild id; fall back to the connected guild.
  const guildId = channel.guildId || channel.guild?.id || fallback.guildId || null;
  return { channel, guildId };
}

async function postNewPublished(client) {
  for (const { post_id: postId, game_slug: gameSlug } of await listUnpostedPublishedNewsPosts()) {
    try {
      const resolved = await resolveChannel(client, gameSlug);
      if (!resolved) {
        logger.debug(`[news] no channel resolved for post ${postId} (${gameSlug}); skipping`);
        continue;
      }
      const post = await getEwcNewsPostById(postId);
      if (!post) continue;
      const game = await getEwcGame(gameSlug);
      const sent = await resolved.channel.send(buildNewsPayload(post, game));
      await recordDiscordNewsPost(postId, {
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
  for (const row of await listDiscordNewsPosts()) {
    try {
      if (row.status !== 'published') {
        // Unpublished (status back to draft): delete the Discord message and the row.
        // The polling job re-posts if the post is published again later.
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (channel?.isTextBased?.()) {
          const message = await channel.messages.fetch(row.message_id).catch(() => null);
          if (message) await message.delete().catch((e) => logger.warn(`[news] delete failed for ${row.post_id}: ${e.message}`));
        }
        await deleteDiscordNewsPost(row.post_id);
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
          await deleteDiscordNewsPost(row.post_id);
          logger.warn(`[news] message ${row.message_id} for news ${row.post_id} is gone; re-posting next tick`);
          continue;
        }
        const post = await getEwcNewsPostById(row.post_id);
        if (!post) continue;
        const game = await getEwcGame(row.game_slug);
        await message.edit(buildNewsPayload(post, game));
        await touchDiscordNewsPost(row.post_id);
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
