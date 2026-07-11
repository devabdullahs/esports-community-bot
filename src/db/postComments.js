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
    authorAvatarUrl: row.author_avatar_url || null,
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

// Shared hydrator for post_comments rows, so sibling modules (e.g. commentReports)
// can return comments in the same shape without duplicating the mapping.
export function hydrateComment(row) {
  return hydrate(row);
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
  authorAvatarUrl = null,
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
        'SELECT id, post_id, root_comment_id, status, discord_user_id FROM post_comments WHERE id = $1',
        [parentCommentId],
      );
      if (!parent || Number(parent.post_id) !== Number(postId)) {
        return { error: 'parent-not-found' };
      }
      // One level: attach under the parent's root (or the parent itself if it is a root).
      rootId = parent.root_comment_id ?? parent.id;
      const root =
        Number(rootId) === Number(parent.id)
          ? parent
          : await tx.get('SELECT id, status, discord_user_id FROM post_comments WHERE id = $1', [rootId]);
      if (!root) return { error: 'parent-not-found' };
      // A reply may only land in an interactable thread: both the immediate parent
      // AND the thread root must be visible, OR pending and owned by the replier
      // (replying inside your own pending thread). This blocks replies to deleted,
      // hidden, rejected, or someone else's pending comments.
      const interactable = (node) =>
        node.status === 'visible' ||
        (node.status === 'pending' && node.discord_user_id === discordUserId);
      if (!interactable(parent) || !interactable(root)) {
        return { error: 'parent-not-interactable' };
      }
      parentId = rootId;
    }
    const now = nowText();
    const inserted = await tx.get(
      `INSERT INTO post_comments
         (post_id, parent_comment_id, root_comment_id, auth_user_id, discord_user_id,
          author_name, author_avatar_url, body, status, flag_reason_json, auto_approve_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       RETURNING id`,
      [
        postId,
        parentId,
        rootId,
        authUserId,
        discordUserId,
        authorName,
        authorAvatarUrl,
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

// Comments shown on the public post page: the latest `limit` root threads
// (default 100, hard max 200) plus all their replies.
// Deleted roots are included so the service can keep a placeholder for threads
// that still have live replies. `includeAllStatuses` widens the set to hidden +
// rejected too — the moderator inline view, which shows and can act on those.
export async function listCommentsForPost(postId, limit = 100, { includeAllStatuses = false } = {}) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 100));
  const statuses = includeAllStatuses
    ? "('visible','pending','hidden','rejected','deleted')"
    : "('visible','pending','deleted')";
  // Fetch the most recent N root comments first.
  const roots = await all(
    `SELECT * FROM post_comments
     WHERE post_id = $1 AND root_comment_id IS NULL AND status IN ${statuses}
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [postId, cap],
  );
  if (roots.length === 0) return [];
  // Fetch all replies for those roots.
  const rootIds = roots.map((r) => r.id);
  const placeholders = rootIds.map((_, i) => `$${i + 2}`).join(',');
  const replies = await all(
    `SELECT * FROM post_comments
     WHERE post_id = $1 AND root_comment_id IN (${placeholders}) AND status IN ${statuses}
     ORDER BY created_at ASC, id ASC`,
    [postId, ...rootIds],
  );
  // Return roots oldest-first within the returned window, then replies.
  return [...roots.reverse(), ...replies].map(hydrate);
}

// Edit an author's own comment. The caller re-runs moderation and passes the
// resulting status/flags so an edited comment can drop back to pending.
// Moderation state is enforced HERE, atomically, in one statement — the
// route's pre-checks are UX only:
//   - hidden/rejected/deleted rows never match, so a concurrent moderator
//     hide/reject between the caller's read and this write wins;
//   - a comment held by unresolved reports stays 'pending' with no
//     auto-approve timer, whatever status the caller computed.
export async function editComment(id, { body, status, flagReason = null, autoApproveAt = null }) {
  const now = nowText();
  const info = await run(
    `UPDATE post_comments
     SET body = $1,
         status = CASE WHEN EXISTS (
             SELECT 1 FROM comment_reports r
             WHERE r.comment_id = post_comments.id AND r.status = 'open'
           ) THEN 'pending' ELSE $2 END,
         flag_reason_json = $3,
         auto_approve_at = CASE WHEN EXISTS (
             SELECT 1 FROM comment_reports r
             WHERE r.comment_id = post_comments.id AND r.status = 'open'
           ) THEN NULL ELSE $4 END,
         updated_at = $5, edited_at = $5
     WHERE id = $6 AND status NOT IN ('deleted', 'hidden', 'rejected')`,
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

// Atomically hold a still-visible comment for review (report auto-hide). The
// `status = 'visible'` guard makes this a no-op if a moderator or the author
// already moved the comment, so a racing report can't clobber that decision.
// Returns true only when this call performed the transition.
export async function holdVisibleCommentForReports(id) {
  const now = nowText();
  const info = await run(
    "UPDATE post_comments SET status = 'pending', updated_at = $1 WHERE id = $2 AND status = 'visible'",
    [now, id],
  );
  return (info?.changes ?? info?.rowCount ?? 0) > 0;
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
