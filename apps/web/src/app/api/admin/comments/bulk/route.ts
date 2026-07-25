import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import {
  BULK_MODERATION_MAX_IDS,
  parseBulkModerationAction,
  parseId,
} from "@/lib/comment-validation";
import { sameOriginOr403 } from "@/lib/community";
import { moderateCommentsAtomically } from "@/lib/comments";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BULK_MODERATION_BODY_MAX_BYTES = 64 * 1024;

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

  const parsed = await readBoundedJson<{
    ids?: unknown;
    action?: unknown;
    reason?: unknown;
  }>(request, BULK_MODERATION_BODY_MAX_BYTES);
  if (!parsed.ok) return requestBodyErrorResponse(parsed.reason);
  const body = parsed.value;
  if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > BULK_MODERATION_MAX_IDS) {
    return NextResponse.json({ error: `Provide 1-${BULK_MODERATION_MAX_IDS} comment ids.` }, { status: 400 });
  }
  const action = parseBulkModerationAction(body.action);
  if (!action) return NextResponse.json({ error: "Unknown bulk moderation action" }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const ids: number[] = [];
  const seen = new Set<number>();
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
    ids.push(id);
  }

  if (failed.length > 0) {
    return NextResponse.json({ updated: [], failed }, { status: 400 });
  }

  const result = await moderateCommentsAtomically(ids, action, {
    discordUserId: access.discordUserId,
    displayName: access.displayName,
  }, reason);
  if (!result.ok) {
    return NextResponse.json({ updated: [], failed: result.failed }, { status: 409 });
  }

  const updated = result.comments.map((comment) => ({
    id: Number(comment.id),
    status: comment.status,
  }));
  for (const comment of result.comments) {
    recordAdminAudit(access, `comment.bulk.${action}`, String(comment.id), {
      targetType: comment.targetType,
      targetId: Number(comment.targetId),
    });
  }
  return NextResponse.json({ updated, failed: [] });
}
