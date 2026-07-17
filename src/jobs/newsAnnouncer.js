import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.js';
import { getEwcGame } from '../db/ewcGames.js';
import { getEwcMediaChannel } from '../db/ewcMediaChannels.js';
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
import { buildNewsDiscordAnnouncementPreview } from '../lib/newsCrossPost.js';
import { logger } from '../lib/logger.js';
import { runScheduledNewsPublisher } from './scheduledNewsPublisher.js';

// Auto-posts published news to Discord. Lifecycle per design doc, with ONE documented v1
// deviation on delete-propagation: ewc_news_discord_posts.post_id has ON DELETE CASCADE, so
// hard-deleting a post removes its row before any tick can observe it. We therefore CANNOT
// clean up the orphaned Discord message for hard-deleted posts in v1 (the message stays).
// Unpublish (status -> draft) keeps the post+row alive, so that path DOES delete the message.
// Acceptable for v1; a future version could soft-capture message ids before deletion.

// AR primary, EN fallback (community is Arabic-first). getTranslationForLocale already
// falls back: requested -> defaultLocale -> en -> ar -> null. Discord receives a
// concise preview; the website remains the authoritative home of the full article.
export function buildNewsPayload(post, game = null) {
  const preview = buildNewsDiscordAnnouncementPreview(post, {
    baseUrl: config.dashboard.publicUrl,
    game,
  });
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(preview.title);
  if (preview.url) embed.setURL(preview.url);
  if (preview.description) embed.setDescription(preview.description);
  if (preview.imageUrl) embed.setImage(preview.imageUrl);
  if (preview.byline) {
    embed.setAuthor({
      name: preview.byline,
      ...(preview.authorIconUrl ? { iconURL: preview.authorIconUrl } : {}),
    });
  }
  if (preview.footer) embed.setFooter({ text: preview.footer });
  if (preview.timestamp !== null) embed.setTimestamp(preview.timestamp);

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (preview.url) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(preview.readMoreLabel)
          .setURL(preview.url),
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

async function resolveChannel(client, { gameSlug, mediaSlug }) {
  const fallback = await guildDefaultNewsChannel(client);
  let channelId;
  if (mediaSlug) {
    // Media posts announce only to their channel's configured Discord channel.
    const media = await getEwcMediaChannel(mediaSlug);
    channelId = media?.discordChannelId || null;
  } else {
    const game = await getEwcGame(gameSlug);
    channelId = resolveNewsChannelId({
      gameChannelId: game?.discordChannelId || null,
      guildNewsChannelId: fallback.channelId,
    });
  }
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  // Prefer the channel's own guild id; fall back to the connected guild.
  const guildId = channel.guildId || channel.guild?.id || fallback.guildId || null;
  return { channel, guildId };
}

export async function postNewPublished(client, {
  listCandidates = listUnpostedPublishedNewsPosts,
  resolvePostChannel = resolveChannel,
  getPost = getEwcNewsPostById,
  getGame = getEwcGame,
  recordPost = recordDiscordNewsPost,
} = {}) {
  for (const { post_id: postId, game_slug: gameSlug, media_slug: mediaSlug } of await listCandidates()) {
    try {
      const resolved = await resolvePostChannel(client, { gameSlug, mediaSlug });
      if (!resolved) {
        logger.debug(`[news] no channel resolved for post ${postId} (${mediaSlug || gameSlug}); skipping`);
        continue;
      }
      const post = await getPost(postId);
      // The outbox candidate list is only a snapshot. Re-check after channel
      // resolution so a concurrent unpublish/cancel cannot announce stale copy.
      if (!post || post.status !== 'published') continue;
      // Footer uses the related game when present (media posts may omit it).
      const game = await getGame(gameSlug);
      const sent = await resolved.channel.send(buildNewsPayload(post, game));
      await recordPost(postId, {
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
  await runScheduledNewsPublisher();
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
