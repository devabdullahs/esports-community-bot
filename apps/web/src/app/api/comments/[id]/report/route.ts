import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { getCommentById, reportPostComment } from "@/lib/comments";
import { COMMENT_REPORT_DETAIL_MAX, parseId, parseReportReason } from "@/lib/comment-validation";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verified members can report a comment they can see. One report per user per
// comment (a repeat is a silent no-op). Enough distinct reports auto-hold the
// comment for review — see reportPostComment.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const { member } = gate;

  const userLimited = await rateLimitOr429({ key: `comment:report:${member.discordUserId}`, limit: 10, windowSec: 3600 });
  if (userLimited) return userLimited;
  const ipLimited = await rateLimitOr429({ key: `comment:report:ip:${clientIp(request)}`, limit: 30, windowSec: 3600 });
  if (ipLimited) return ipLimited;

  const body = await request.json().catch(() => ({}));
  const reason = parseReportReason(body?.reason);
  if (!reason) return NextResponse.json({ error: "Choose a reason for the report." }, { status: 400 });
  const detail = typeof body?.detail === "string" ? body.detail.slice(0, COMMENT_REPORT_DETAIL_MAX) : "";

  const comment = await getCommentById(id);
  // Only report something you can actually see: a live (non-deleted) comment
  // that isn't your own.
  if (!comment || comment.status === "deleted") {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (comment.discordUserId === member.discordUserId) {
    return NextResponse.json({ error: "You can't report your own comment." }, { status: 400 });
  }

  const { created, held } = await reportPostComment(
    id,
    { discordUserId: member.discordUserId, authUserId: member.authUserId },
    { reason, detail },
  );
  return NextResponse.json({ ok: true, created, held });
}
