import "server-only";

import {
  listAdminAuditLog as _list,
  recordAdminAudit as _record,
} from "@bot/db/ewcAdminAuditLog.js";
import type { AdminAccess } from "@/lib/admin";

export type AuditEntry = {
  id: number;
  actorId: string;
  actorName: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const record = _record as (params: {
  actorId: string;
  actorName: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
}) => void;

const list = _list as (limit?: number, offset?: number) => AuditEntry[];

/**
 * Record a successful admin mutation in the audit log.
 *
 * Deliberately swallows its own errors — a logging failure must NEVER break
 * the request that triggered it. Only successful mutations should be logged
 * (do not call this on 4xx/5xx paths).
 *
 * Details should contain slugs, ids, and status values only — never request
 * bodies wholesale or any secret material.
 *
 * @param access  - The AdminAccess object returned by getAdminAccess().
 * @param action  - Dot-namespaced action string, e.g. "game.create".
 * @param target  - The primary identifier (slug, post id, discord id), or null.
 * @param details - Optional safe subset of action context (no secrets).
 */
export function recordAdminAudit(
  access: AdminAccess,
  action: string,
  target: string | null,
  details?: Record<string, unknown>,
): void {
  if (!access.discordUserId) return;
  try {
    record({
      actorId: access.discordUserId,
      actorName: access.displayName ?? null,
      action,
      target,
      details: details ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to record", err);
  }
}

export function listAuditLog(limit = 100, offset = 0): AuditEntry[] {
  return list(limit, offset);
}
