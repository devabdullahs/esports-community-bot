import { all } from './client.js';

// A comma-joined `$start..$(start+count-1)` placeholder list.
function placeholders(count, start = 1) {
  return Array.from({ length: count }, (_, i) => `$${start + i}`).join(',');
}

const DATE_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

function timeValue(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = DATE_WITHOUT_ZONE_RE.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function latestTime(...values) {
  let best = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const ms = timeValue(value);
    if (ms == null || ms <= bestMs) continue;
    best = value;
    bestMs = ms;
  }
  return best;
}

// Build the two activity-rollup queries for a set of ids. Exported so the
// dual-backend placeholder invariant is unit-testable: the likes query refers to
// the ids in TWO IN clauses, so on Postgres they MUST use DISTINCT placeholders
// ($1..$N then $(N+1)..$2N) with the ids passed twice — reusing $1..$N there
// fails ("bind message supplies 2N parameters, but prepared statement requires
// N"), even though SQLite's per-occurrence rewrite tolerates the reuse.
export function activityQueries(ids) {
  const n = ids.length;
  return {
    comments: {
      sql: `SELECT discord_user_id,
              COUNT(*) AS comment_count,
              MAX(created_at) AS last_comment_at
       FROM post_comments
       WHERE discord_user_id IN (${placeholders(n)}) AND status <> 'deleted'
       GROUP BY discord_user_id`,
      params: ids,
    },
    likes: {
      sql: `SELECT discord_user_id, COUNT(*) AS like_count, MAX(created_at) AS last_like_at FROM (
         SELECT discord_user_id, created_at FROM comment_likes WHERE discord_user_id IN (${placeholders(n, 1)})
         UNION ALL
         SELECT discord_user_id, created_at FROM post_likes WHERE discord_user_id IN (${placeholders(n, n + 1)})
       ) AS combined
       GROUP BY discord_user_id`,
      params: [...ids, ...ids],
    },
  };
}

// Activity rollups for a set of Discord user ids, keyed by discord_user_id.
// Comment counts + last-comment timestamp exclude soft-deleted rows; like
// counts span both comment_likes and post_likes. `lastActivityAt` is the newest
// visible community action we can infer from those tables. Returns an empty Map
// when no ids are given (so callers can skip the query for an empty page).
export async function activityForDiscordIds(ids) {
  const result = new Map();
  if (!Array.isArray(ids) || ids.length === 0) return result;

  for (const id of ids) {
    result.set(String(id), {
      commentCount: 0,
      lastCommentAt: null,
      likeCount: 0,
      lastLikeAt: null,
      lastActivityAt: null,
    });
  }

  const { comments: cq, likes: lq } = activityQueries(ids);

  const comments = await all(cq.sql, cq.params);
  for (const row of comments) {
    const entry = result.get(String(row.discord_user_id));
    if (!entry) continue;
    entry.commentCount = Number(row.comment_count) || 0;
    entry.lastCommentAt = row.last_comment_at ?? null;
  }

  const likes = await all(lq.sql, lq.params);
  for (const row of likes) {
    const entry = result.get(String(row.discord_user_id));
    if (!entry) continue;
    entry.likeCount = Number(row.like_count) || 0;
    entry.lastLikeAt = row.last_like_at ?? null;
  }

  for (const entry of result.values()) {
    entry.lastActivityAt = latestTime(entry.lastCommentAt, entry.lastLikeAt);
  }

  return result;
}

// A member's comments newest-first, ALL statuses (the moderation view needs to
// see hidden/deleted rows too).
export async function listCommentsByAuthor(discordUserId, limit = 50) {
  const rows = await all(
    `SELECT id, post_id, target_type, target_id, body, status, created_at
     FROM post_comments
     WHERE discord_user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [discordUserId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id ?? null,
    targetType: row.target_type ?? 'news',
    targetId: row.target_id ?? row.post_id,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  }));
}
