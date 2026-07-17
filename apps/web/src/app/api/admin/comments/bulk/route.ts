import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import {
  BULK_MODERATION_MAX_IDS,
  parseBulkModerationAction,
  parseId,
} from "@/lib/comment-validation";
import { sameOriginOr403 } from "@/lib/community";
import { getCommentById, moderateComment } from "@/lib/comments";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reportedId(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : JSON.stringify(value);
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A batch can span unrelated game and media targets. Keep it global-only
  // until comment ownership has a first-class scoped authorization model.
  if (!access.isSuper || !access.discordUserId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limited = await rateLimitOr429({ key: `comment:bulk-moderate:${access.discordUserId}`, limit: 20, windowSec: 600 });
  if (limited) return limited;

  const body = await request.json().catch(() => null) as { ids?: unknown; action?: unknown; reason?: unknown } | null;
  if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > BULK_MODERATION_MAX_IDS) {
    return NextResponse.json({ error: `Provide 1-${BULK_MODERATION_MAX_IDS} comment ids.` }, { status: 400 });
  }
  const action = parseBulkModerationAction(body.action);
  if (!action) return NextResponse.json({ error: "Unknown bulk moderation action" }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const seen = new Set<number>();
  const updated: Array<{ id: number; status: string }> = [];
  const failed: Array<{ id: string | number; error: string }> = [];
  for (const rawId of body.ids) {
    const id = parseId(String(rawId));
    if (id === null) {
      failed.push({ id: reportedId(rawId), error: "invalid-id" });
      continue;
    }
    if (seen.has(id)) {
      failed.push({ id, error: "duplicate-id" });
      continue;
    }
    seen.add(id);
    try {
      const existing = await getCommentById(id);
      if (!existing) {
        failed.push({ id, error: "not-found" });
        continue;
      }
      if (existing.status === "deleted") {
        failed.push({ id, error: "invalid-status" });
        continue;
      }
      const comment = await moderateComment(id, action, {
        discordUserId: access.discordUserId,
        displayName: access.displayName,
      }, reason);
      if (!comment) {
        failed.push({ id, error: "invalid-status" });
        continue;
      }
      updated.push({ id: Number(comment.id), status: comment.status });
      recordAdminAudit(access, `comment.bulk.${action}`, String(comment.id), {
        targetType: comment.targetType,
        targetId: Number(comment.targetId),
      });
    } catch {
      failed.push({ id, error: "update-failed" });
    }
  }

  return NextResponse.json({ updated, failed });
}
