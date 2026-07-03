import { all, get, run } from './client.js';
import { hydrateComment } from './postComments.js';

// User reports on community comments. One report per (comment, reporter): a
// repeat by the same user is a no-op. Prepared, parameterized statements only.

export const COMMENT_REPORT_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'other'];
export const COMMENT_REPORT_STATUSES = ['open', 'resolved', 'dismissed'];

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

// Create a report. Returns { created, openCount }: `created` is false when the
// reporter already had a report on this comment; `openCount` is the number of
// DISTINCT reporters with an OPEN report (drives the auto-hide threshold).
export async function createCommentReport({
  commentId,
  reporterDiscordId,
  reporterAuthUserId = null,
  reason,
  detail = '',
}) {
  const inserted = await get(
    `INSERT INTO comment_reports
       (comment_id, reporter_discord_id, reporter_auth_user_id, reason, detail, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'open', $6)
     ON CONFLICT (comment_id, reporter_discord_id) DO NOTHING
     RETURNING id`,
    [
      Number(commentId),
      String(reporterDiscordId),
      reporterAuthUserId ? String(reporterAuthUserId) : null,
      reason,
      clean(detail),
      nowText(),
    ],
  );
  const openCount = await countOpenReportsForComment(commentId);
  return { created: Boolean(inserted), openCount };
}

export async function countOpenReportsForComment(commentId) {
  const row = await get(
    "SELECT COUNT(*) AS c FROM comment_reports WHERE comment_id = $1 AND status = 'open'",
    [Number(commentId)],
  );
  return Number(row?.c || 0);
}

// comment_id -> open report count, for annotating a batch of comments (the
// moderator inline view and the admin queue).
export async function openReportCountsForComments(ids) {
  const list = (ids ?? []).map(Number).filter(Number.isFinite);
  if (!list.length) return {};
  const placeholders = list.map((_, i) => `$${i + 1}`).join(',');
  const rows = await all(
    `SELECT comment_id, COUNT(*) AS c FROM comment_reports
     WHERE status = 'open' AND comment_id IN (${placeholders})
     GROUP BY comment_id`,
    list,
  );
  return Object.fromEntries(rows.map((r) => [Number(r.comment_id), Number(r.c)]));
}

// Reported comments for the admin queue: hydrated comment rows plus their open
// report count (reportOpenCount), most-reported first.
export async function listReportedComments({ limit = 100, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await all(
    `SELECT c.*, r.open_count AS report_open_count
       FROM post_comments c
       JOIN (
         SELECT comment_id, COUNT(*) AS open_count
           FROM comment_reports WHERE status = 'open' GROUP BY comment_id
       ) r ON r.comment_id = c.id
      ORDER BY r.open_count DESC, c.created_at DESC
      LIMIT $1 OFFSET $2`,
    [lim, off],
  );
  return rows.map((row) => ({ ...hydrateComment(row), reportOpenCount: Number(row.report_open_count || 0) }));
}

// Individual open reports on one comment (reason/detail/reporter), for a mod
// drill-down.
export async function listReportsForComment(commentId) {
  return all(
    `SELECT id, comment_id, reporter_discord_id, reason, detail, status, created_at
       FROM comment_reports WHERE comment_id = $1
      ORDER BY created_at DESC, id DESC`,
    [Number(commentId)],
  );
}

// Close out a comment's open reports once a moderator has acted on it.
export async function resolveReportsForComment(commentId, status = 'resolved') {
  const next = COMMENT_REPORT_STATUSES.includes(status) && status !== 'open' ? status : 'resolved';
  const info = await run(
    "UPDATE comment_reports SET status = $1 WHERE comment_id = $2 AND status = 'open'",
    [next, Number(commentId)],
  );
  return { updated: info?.changes ?? info?.rowCount ?? 0 };
}

export async function countCommentsWithOpenReports() {
  const row = await get(
    "SELECT COUNT(DISTINCT comment_id) AS c FROM comment_reports WHERE status = 'open'",
  );
  return Number(row?.c || 0);
}
