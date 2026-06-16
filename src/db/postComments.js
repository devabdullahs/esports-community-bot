import { all, get, run, transaction } from './client.js';

// Community comments on news posts. Prepared, parameterized statements only.
// Threads are ONE level: a reply's parent_comment_id and root_comment_id both
// point at the ROOT comment, and a reply-to-a-reply is re-targeted to that root
// (see createComment). Deletes are SOFT (status='deleted') so reply threads keep
// rendering; a placeholder is shown for a deleted root that still has replies.

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
function nowSec() {
  return Math.floor(Date.now() / 1000);
}
function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id ?? null,
    rootCommentId: row.root_comment_id ?? null,
    authUserId: row.auth_user_id,
    discordUserId: row.discord_user_id,
    authorName: row.author_name || '',
    body: row.body,
    status: row.status,
    flagReason: parseJson(row.flag_reason_json, null),
    autoApproveAt: row.auto_approve_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
    deletedBy: row.deleted_by ?? null,
  };
}

export async function getComment(id) {
  return hydrate(await get('SELECT * FROM post_comments WHERE id = $1', [id]));
}

/**
 * Insert a comment. For a reply, `parentCommentId` is the comment the user
 * clicked reply on; the real thread root is resolved here (a reply-to-a-reply
 * attaches to the root). Returns { comment } or { error } if the parent is
 * missing / on another post.
 */
export async function createComment({
  postId,
  parentCommentId = null,
  authUserId,
  discordUserId,
  authorName = '',
  body,
  status = 'visible',
  flagReason = null,
  autoApproveAt = null,
}) {
  return transaction(async (tx) => {
    let parentId = null;
    let rootId = null;
    if (parentCommentId) {
      const parent = await tx.get(
        'SELECT id, post_id, root_comment_id, status FROM post_comments WHERE id = $1',
        [parentCommentId],
      );
      if (!parent || Number(parent.post_id) !== Number(postId)) {
        return { error: 'parent-not-found' };
      }
      // One level: attach under the parent's root (or the parent itself if it is a root).
      rootId = parent.root_comment_id ?? parent.id;
      parentId = rootId;
    }
    const now = nowText();
    const inserted = await tx.get(
      `INSERT INTO post_comments
         (post_id, parent_comment_id, root_comment_id, auth_user_id, discord_user_id,
          author_name, body, status, flag_reason_json, auto_approve_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING id`,
      [
        postId,
        parentId,
        rootId,
        authUserId,
        discordUserId,
        authorName,
        body,
        status,
        flagReason ? JSON.stringify(flagReason) : null,
        autoApproveAt,
        now,
      ],
    );
    return { comment: hydrate(await tx.get('SELECT * FROM post_comments WHERE id = $1', [inserted.id])) };
  });
}

// Comments shown on the public post page: visible, the viewer's own pending, and
// deleted (the service keeps a deleted root only when it still has replies).
export async function listCommentsForPost(postId) {
  const rows = await all(
    `SELECT * FROM post_comments
     WHERE post_id = $1 AND status IN ('visible','pending','deleted')
     ORDER BY created_at ASC, id ASC`,
    [postId],
  );
  return rows.map(hydrate);
}

// Edit an author's own comment. The caller re-runs moderation and passes the
// resulting status/flags so an edited comment can drop back to pending.
export async function editComment(id, { body, status, flagReason = null, autoApproveAt = null }) {
  const now = nowText();
  const info = await run(
    `UPDATE post_comments
     SET body = $1, status = $2, flag_reason_json = $3, auto_approve_at = $4,
         updated_at = $5, edited_at = $5
     WHERE id = $6 AND status <> 'deleted'`,
    [body, status, flagReason ? JSON.stringify(flagReason) : null, autoApproveAt, now, id],
  );
  if (info.changes === 0) return null;
  return getComment(id);
}

/**
 * Set a comment's moderation status. Used by author soft-delete (status
 * 'deleted', deletedBy = author) and by moderators (approve->visible,
 * reject->rejected, hide->hidden, restore->visible, delete->deleted).
 */
export async function setCommentStatus(id, status, { deletedBy = null } = {}) {
  const now = nowText();
  const sets = ['status = $1', 'updated_at = $2'];
  const params = [status, now];
  // Approving/rejecting/hiding clears the link auto-approve timer.
  if (status !== 'pending') sets.push('auto_approve_at = NULL');
  if (status === 'deleted') {
    params.push(now);
    sets.push(`deleted_at = $${params.length}`);
    params.push(deletedBy);
    sets.push(`deleted_by = $${params.length}`);
  } else {
    // Restoring (to visible/hidden/etc.) clears the delete markers.
    sets.push('deleted_at = NULL', 'deleted_by = NULL');
  }
  params.push(id);
  const info = await run(`UPDATE post_comments SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (info.changes === 0) return null;
  return getComment(id);
}

// Auto-approve link-only pending comments whose timer elapsed. Profanity-flagged
// comments have auto_approve_at = NULL and are never touched here — a moderator
// must act on those.
export async function autoApproveDueComments(at = nowSec()) {
  const due = await all(
    `SELECT id FROM post_comments
     WHERE status = 'pending' AND auto_approve_at IS NOT NULL AND auto_approve_at <= $1`,
    [at],
  );
  if (due.length === 0) return { approved: 0, ids: [] };
  await run(
    `UPDATE post_comments SET status = 'visible', auto_approve_at = NULL, updated_at = $1
     WHERE status = 'pending' AND auto_approve_at IS NOT NULL AND auto_approve_at <= $2`,
    [nowText(), at],
  );
  return { approved: due.length, ids: due.map((r) => r.id) };
}

// --- moderation queue -------------------------------------------------------

// `flagged` (a pseudo-filter, not a status) = anything that ever tripped a
// profanity/link flag (flag_reason_json present), regardless of current status.
export async function listCommentsForModeration({ status = null, flagged = false, limit = 100, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (flagged) where.push('flag_reason_json IS NOT NULL');
  params.push(lim, off);
  const sql = `SELECT * FROM post_comments${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await all(sql, params)).map(hydrate);
}

export async function countCommentsByStatus() {
  const rows = await all('SELECT status, COUNT(*) AS c FROM post_comments GROUP BY status');
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.c)]));
}
