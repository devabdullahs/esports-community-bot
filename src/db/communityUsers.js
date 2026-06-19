import { all } from './client.js';

// Activity rollups for a set of Discord user ids, keyed by discord_user_id.
// Comment counts + last-comment timestamp exclude soft-deleted rows; like
// counts span both comment_likes and post_likes. Returns an empty Map when no
// ids are given (so callers can skip the query for an empty page).
export async function activityForDiscordIds(ids) {
  const result = new Map();
  if (!Array.isArray(ids) || ids.length === 0) return result;

  for (const id of ids) {
    result.set(String(id), { commentCount: 0, lastCommentAt: null, likeCount: 0 });
  }

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

  const comments = await all(
    `SELECT discord_user_id,
            COUNT(*) AS comment_count,
            MAX(created_at) AS last_comment_at
     FROM post_comments
     WHERE discord_user_id IN (${placeholders}) AND status <> 'deleted'
     GROUP BY discord_user_id`,
    ids,
  );
  for (const row of comments) {
    const entry = result.get(String(row.discord_user_id));
    if (!entry) continue;
    entry.commentCount = Number(row.comment_count) || 0;
    entry.lastCommentAt = row.last_comment_at ?? null;
  }

  const likes = await all(
    `SELECT discord_user_id, COUNT(*) AS like_count FROM (
       SELECT discord_user_id FROM comment_likes WHERE discord_user_id IN (${placeholders})
       UNION ALL
       SELECT discord_user_id FROM post_likes WHERE discord_user_id IN (${placeholders})
     ) AS combined
     GROUP BY discord_user_id`,
    [...ids, ...ids],
  );
  for (const row of likes) {
    const entry = result.get(String(row.discord_user_id));
    if (!entry) continue;
    entry.likeCount = Number(row.like_count) || 0;
  }

  return result;
}

// A member's comments newest-first, ALL statuses (the moderation view needs to
// see hidden/deleted rows too).
export async function listCommentsByAuthor(discordUserId, limit = 50) {
  const rows = await all(
    `SELECT id, post_id, body, status, created_at
     FROM post_comments
     WHERE discord_user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [discordUserId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  }));
}
