import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/audit";
import { sameOriginOr403 } from "@/lib/community";
import { getCommentById, moderateComment } from "@/lib/comments";
import { parseId, parseModerationAction } from "@/lib/comment-validation";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const access = await getAdminAccess();
  if (!access.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!access.allowed || !access.discordUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const limited = await rateLimitOr429({ key: `comment:moderate:${access.discordUserId}`, limit: 60, windowSec: 600 });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const action = parseModerationAction(body?.action);
  if (!action) return NextResponse.json({ error: "Unknown moderation action" }, { status: 400 });
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

  const existing = await getCommentById(id);
  if (!existing) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  const updated = await moderateComment(
    id,
    action,
    { discordUserId: access.discordUserId, displayName: access.displayName },
    reason,
  );
  if (!updated) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  // Per-comment moderation table is written by moderateComment; also mirror to the
  // dashboard-wide admin audit log.
  recordAdminAudit(access, `comment.${action}`, String(id), {
    targetType: existing.targetType,
    targetId: Number(existing.targetId),
  });
  return NextResponse.json({ comment: { id: Number(updated.id), status: updated.status } });
}
