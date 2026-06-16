import { all, run } from './client.js';

// Audit rows for every moderator action on a comment (approve/reject/hide/restore/delete).

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function recordCommentModeration({
  commentId,
  moderatorDiscordId,
  moderatorName = null,
  action,
  reason = null,
}) {
  await run(
    `INSERT INTO comment_moderation_actions
       (comment_id, moderator_discord_id, moderator_name, action, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [commentId, moderatorDiscordId, moderatorName, action, reason, nowText()],
  );
}

export async function listCommentModerationActions(commentId) {
  return all(
    `SELECT id, comment_id, moderator_discord_id, moderator_name, action, reason, created_at
     FROM comment_moderation_actions WHERE comment_id = $1 ORDER BY created_at DESC, id DESC`,
    [commentId],
  );
}
