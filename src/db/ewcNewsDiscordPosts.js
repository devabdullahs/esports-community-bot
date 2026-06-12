import { db } from './index.js';

// Side table linking a published ewc_news_post to the Discord message that announces it.
// One row per post (single-guild deployment). The row is cleaned up by ON DELETE CASCADE
// when the post is deleted, or explicitly on unpublish via deleteDiscordNewsPost.

// Anti-join: published posts that do not yet have a Discord row. These need an initial post.
export function listUnpostedPublishedNewsPosts() {
  return db
    .prepare(
      `SELECT p.id AS post_id, p.game_slug AS game_slug
       FROM ewc_news_posts p
       LEFT JOIN ewc_news_discord_posts d ON d.post_id = p.id
       WHERE p.status = 'published' AND d.post_id IS NULL
       ORDER BY p.published_at ASC, p.id ASC`,
    )
    .all();
}

// Rows whose post is still published, joined with the post's updated_at so the job can
// decide whether an edit is due (post.updated_at newer than the recorded posted_at) and
// whether the post has been unpublished (status back to 'draft').
export function listDiscordNewsPosts() {
  return db
    .prepare(
      `SELECT d.post_id AS post_id, d.guild_id AS guild_id, d.channel_id AS channel_id,
              d.message_id AS message_id, d.posted_at AS posted_at,
              p.status AS status, p.updated_at AS updated_at, p.game_slug AS game_slug
       FROM ewc_news_discord_posts d
       JOIN ewc_news_posts p ON p.id = d.post_id
       ORDER BY d.post_id ASC`,
    )
    .all();
}

export function getDiscordNewsPost(postId) {
  return db.prepare('SELECT * FROM ewc_news_discord_posts WHERE post_id = ?').get(postId) ?? null;
}

export function recordDiscordNewsPost(postId, { guildId, channelId, messageId }) {
  db.prepare(
    `INSERT INTO ewc_news_discord_posts (post_id, guild_id, channel_id, message_id, posted_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (post_id) DO UPDATE SET
       guild_id = excluded.guild_id,
       channel_id = excluded.channel_id,
       message_id = excluded.message_id,
       posted_at = datetime('now')`,
  ).run(postId, guildId, channelId, messageId);
}

// Bump posted_at after a successful edit so the next tick does not re-edit unnecessarily.
export function touchDiscordNewsPost(postId) {
  db.prepare(`UPDATE ewc_news_discord_posts SET posted_at = datetime('now') WHERE post_id = ?`).run(postId);
}

export function deleteDiscordNewsPost(postId) {
  return db.prepare('DELETE FROM ewc_news_discord_posts WHERE post_id = ?').run(postId);
}

// Channel resolution order: per-game channel → guild-level news channel → null (skip).
// Pure function so it is testable without a Discord client.
export function resolveNewsChannelId({ gameChannelId, guildNewsChannelId }) {
  return gameChannelId || guildNewsChannelId || null;
}
