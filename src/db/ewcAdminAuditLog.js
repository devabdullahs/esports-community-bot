import { all, get, run } from './client.js';

const SCHEDULED_PUBLISH_ACTION = 'news.publish_scheduled';
const NEWS_CACHE_REVALIDATED_ACTION = 'news.cache_revalidated';

/**
 * Safe JSON parser — returns null for missing or malformed detail blobs
 * rather than throwing. Matches the same guard pattern used in ewcNewsPosts.js.
 */
function parseJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Record a dashboard admin action.
 *
 * @param {object} params
 * @param {string} params.actorId       - Discord user ID of the admin who acted.
 * @param {string|null} params.actorName - Display name, may be null.
 * @param {string} params.action        - Dot-namespaced action string (e.g. "game.create").
 * @param {string|null} params.target   - Affected slug, post id, or discord id.
 * @param {object|null} params.details  - Safe subset of action context (no secrets).
 *                                        Serialised to JSON before storage.
 */
export async function recordAdminAudit({ actorId, actorName, action, target, details }, client = null) {
  const detailsJson = details != null ? JSON.stringify(details) : null;
  await (client || { run }).run(
    `INSERT INTO ewc_admin_audit_log (actor_id, actor_name, action, target, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, actorName ?? null, action, target ?? null, detailsJson],
  );
}

/**
 * Return the most recent audit entries, newest-first.
 *
 * @param {number} limit  - Maximum rows to return (default 100).
 * @param {number} offset - Row offset for pagination (default 0).
 * @returns {{ id: number, actorId: string, actorName: string|null, action: string,
 *             target: string|null, details: object|null, createdAt: string }[]}
 */
export async function listAdminAuditLog(limit = 100, offset = 0) {
  const rows = await all(
    `SELECT id, actor_id, actor_name, action, target, details, created_at
     FROM ewc_admin_audit_log
     ORDER BY created_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [Math.max(1, Math.min(500, Number(limit) || 100)), Math.max(0, Number(offset) || 0)],
  );

  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    target: row.target,
    details: parseJson(row.details),
    createdAt: row.created_at,
  }));
}

// The audit ids form a durable publication/revalidation watermark. If the
// process exits after publishing but before invalidating the dashboard cache,
// the next process observes the unmatched publication and retries.
export async function hasPendingScheduledNewsCacheRevalidation() {
  const row = await get(
    `SELECT CASE WHEN EXISTS (
       SELECT 1
       FROM ewc_admin_audit_log published
       WHERE published.action = $1
         AND published.id > COALESCE((
           SELECT MAX(revalidated.id)
           FROM ewc_admin_audit_log revalidated
           WHERE revalidated.action = $2
         ), 0)
     ) THEN 1 ELSE 0 END AS pending`,
    [SCHEDULED_PUBLISH_ACTION, NEWS_CACHE_REVALIDATED_ACTION],
  );
  return Boolean(row?.pending);
}

export async function markScheduledNewsCacheRevalidated() {
  return recordAdminAudit({
    actorId: 'system:scheduled-publisher',
    actorName: 'Scheduled publisher',
    action: NEWS_CACHE_REVALIDATED_ACTION,
    target: null,
    details: null,
  });
}
