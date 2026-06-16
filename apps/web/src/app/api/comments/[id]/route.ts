import { NextResponse } from "next/server";
import { requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { editOwnComment, getCommentById, softDeleteComment } from "@/lib/comments";
import { parseId, validateCommentBody } from "@/lib/comment-validation";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const { member } = gate;

  const existing = await getCommentById(id);
  if (!existing || existing.status === "deleted") {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  // Authors edit only their own comments (server-authoritative — never trust the client).
  if (existing.discordUserId !== member.discordUserId) {
    return NextResponse.json({ error: "You can only edit your own comment." }, { status: 403 });
  }

  const limited = await rateLimitOr429({ key: `comment:edit:${member.discordUserId}`, limit: 10, windowSec: 600 });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const validated = validateCommentBody(body?.body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const updated = await editOwnComment(id, validated.body);
  if (!updated) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  return NextResponse.json({ comment: { id: Number(updated.id), status: updated.status } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const { member } = gate;

  const existing = await getCommentById(id);
  if (!existing) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  if (existing.discordUserId !== member.discordUserId) {
    return NextResponse.json({ error: "You can only delete your own comment." }, { status: 403 });
  }
  if (existing.status === "deleted") return NextResponse.json({ ok: true }); // idempotent

  await softDeleteComment(id, member.discordUserId);
  return NextResponse.json({ ok: true });
}
