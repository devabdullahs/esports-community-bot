import { all, get, run } from './client.js';

// One like per verified user per comment/reply. Same idempotent shape as post likes.

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function setCommentLike(commentId, discordUserId) {
  const info = await run(
    `INSERT INTO comment_likes (comment_id, discord_user_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (comment_id, discord_user_id) DO NOTHING`,
    [commentId, discordUserId, nowText()],
  );
  return { liked: true, created: info.changes > 0 };
}

export async function removeCommentLike(commentId, discordUserId) {
  const info = await run('DELETE FROM comment_likes WHERE comment_id = $1 AND discord_user_id = $2', [
    commentId,
    discordUserId,
  ]);
  return { liked: false, removed: info.changes > 0 };
}

export async function getCommentLikeSummary(commentId, discordUserId = null) {
  const countRow = await get('SELECT COUNT(*) AS c FROM comment_likes WHERE comment_id = $1', [commentId]);
  let liked = false;
  if (discordUserId) {
    liked = Boolean(
      await get('SELECT 1 AS x FROM comment_likes WHERE comment_id = $1 AND discord_user_id = $2', [commentId, discordUserId]),
    );
  }
  return { count: Number(countRow?.c || 0), liked };
}

// Batched helpers for rendering a comment list without N+1 queries.
export async function getCommentLikeCounts(commentIds) {
  if (!commentIds.length) return {};
  const placeholders = commentIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await all(
    `SELECT comment_id, COUNT(*) AS c FROM comment_likes WHERE comment_id IN (${placeholders}) GROUP BY comment_id`,
    commentIds,
  );
  return Object.fromEntries(rows.map((r) => [r.comment_id, Number(r.c)]));
}

export async function getViewerCommentLikes(commentIds, discordUserId) {
  if (!commentIds.length || !discordUserId) return new Set();
  const placeholders = commentIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await all(
    `SELECT comment_id FROM comment_likes
     WHERE discord_user_id = $${commentIds.length + 1} AND comment_id IN (${placeholders})`,
    [...commentIds, discordUserId],
  );
  return new Set(rows.map((r) => r.comment_id));
}
