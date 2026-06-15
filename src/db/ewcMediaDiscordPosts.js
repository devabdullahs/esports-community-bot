import { all, get, run } from './client.js';

// Side table linking a media channel to the Discord message that announces it.
// One row per channel (single-guild). Unlike news (which announces every PUBLISHED
// post), media announcing is OPT-IN: a channel is only announced once an admin sets
// its discord_channel_id, so the pre-seeded channels never auto-post. The row is
// removed explicitly in deleteEwcMediaChannel (no FK cascade on this table).

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Anti-join: channels that opted in (discord_channel_id set) but have no Discord
// row yet. These need an initial post.
export async function listUnpostedAnnounceableMediaChannels() {
  return all(
    `SELECT c.slug AS slug, c.discord_channel_id AS discord_channel_id, c.game_slug AS game_slug
     FROM ewc_media_channels c
     LEFT JOIN ewc_media_discord_posts d ON d.slug = c.slug
     WHERE c.discord_channel_id IS NOT NULL AND c.discord_channel_id <> '' AND d.slug IS NULL
     ORDER BY c.sort_order ASC, c.slug ASC`,
  );
}

// Existing Discord rows joined with the channel so the job can decide whether to
// edit (channel.updated_at newer than posted_at), move (target channel changed),
// or delete (channel opted out: discord_channel_id cleared).
export async function listMediaDiscordPosts() {
  return all(
    `SELECT d.slug AS slug, d.guild_id AS guild_id, d.channel_id AS channel_id,
            d.message_id AS message_id, d.posted_at AS posted_at,
            c.updated_at AS updated_at, c.discord_channel_id AS discord_channel_id,
            c.game_slug AS game_slug
     FROM ewc_media_discord_posts d
     JOIN ewc_media_channels c ON c.slug = d.slug
     ORDER BY d.slug ASC`,
  );
}

export async function getMediaDiscordPost(slug) {
  return (await get('SELECT * FROM ewc_media_discord_posts WHERE slug = $1', [slug])) ?? null;
}

export async function recordMediaDiscordPost(slug, { guildId, channelId, messageId }) {
  const now = nowText();
  await run(
    `INSERT INTO ewc_media_discord_posts (slug, guild_id, channel_id, message_id, posted_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET
       guild_id = excluded.guild_id,
       channel_id = excluded.channel_id,
       message_id = excluded.message_id,
       posted_at = excluded.posted_at`,
    [slug, guildId, channelId, messageId, now],
  );
}

// Bump posted_at after a successful edit so the next tick does not re-edit.
export async function touchMediaDiscordPost(slug) {
  return run('UPDATE ewc_media_discord_posts SET posted_at = $1 WHERE slug = $2', [nowText(), slug]);
}

export async function deleteMediaDiscordPost(slug) {
  return run('DELETE FROM ewc_media_discord_posts WHERE slug = $1', [slug]);
}
