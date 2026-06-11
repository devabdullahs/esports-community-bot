import { db } from './index.js';

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
export function recordAdminAudit({ actorId, actorName, action, target, details }) {
  const detailsJson = details != null ? JSON.stringify(details) : null;
  db.prepare(
    `INSERT INTO ewc_admin_audit_log (actor_id, actor_name, action, target, details)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(actorId, actorName ?? null, action, target ?? null, detailsJson);
}

/**
 * Return the most recent audit entries, newest-first.
 *
 * @param {number} limit  - Maximum rows to return (default 100).
 * @param {number} offset - Row offset for pagination (default 0).
 * @returns {{ id: number, actorId: string, actorName: string|null, action: string,
 *             target: string|null, details: object|null, createdAt: string }[]}
 */
export function listAdminAuditLog(limit = 100, offset = 0) {
  const rows = db
    .prepare(
      `SELECT id, actor_id, actor_name, action, target, details, created_at
       FROM ewc_admin_audit_log
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(Math.max(1, Math.min(500, Number(limit) || 100)), Math.max(0, Number(offset) || 0));

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
