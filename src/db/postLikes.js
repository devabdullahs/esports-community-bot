import { get, run } from './client.js';

// One like per verified user per post. Unique (post_id, discord_user_id) makes
// likes idempotent; unlike is an idempotent DELETE.

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function setPostLike(postId, discordUserId) {
  const info = await run(
    `INSERT INTO post_likes (post_id, discord_user_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (post_id, discord_user_id) DO NOTHING`,
    [postId, discordUserId, nowText()],
  );
  return { liked: true, created: info.changes > 0 };
}

export async function removePostLike(postId, discordUserId) {
  const info = await run('DELETE FROM post_likes WHERE post_id = $1 AND discord_user_id = $2', [
    postId,
    discordUserId,
  ]);
  return { liked: false, removed: info.changes > 0 };
}

export async function getPostLikeSummary(postId, discordUserId = null) {
  const countRow = await get('SELECT COUNT(*) AS c FROM post_likes WHERE post_id = $1', [postId]);
  let liked = false;
  if (discordUserId) {
    liked = Boolean(
      await get('SELECT 1 AS x FROM post_likes WHERE post_id = $1 AND discord_user_id = $2', [postId, discordUserId]),
    );
  }
  return { count: Number(countRow?.c || 0), liked };
}
