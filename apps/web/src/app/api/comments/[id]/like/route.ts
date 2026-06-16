import { NextResponse } from "next/server";
import { requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { getCommentById, getCommentLikeSummary, removeCommentLike, setCommentLike } from "@/lib/comments";
import { parseId } from "@/lib/comment-validation";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return { response: origin };
  const member = await requireVerifiedMember();
  if ("response" in member) return member;
  const limited = await rateLimitOr429({ key: `like:${member.member.discordUserId}`, limit: 60, windowSec: 60 });
  if (limited) return { response: limited };
  return member;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const g = await gate(request);
  if ("response" in g) return g.response;

  const comment = await getCommentById(id);
  if (!comment || comment.status !== "visible") return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  await setCommentLike(id, g.member.discordUserId);
  return NextResponse.json(await getCommentLikeSummary(id, g.member.discordUserId));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = parseId((await context.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const g = await gate(request);
  if ("response" in g) return g.response;

  await removeCommentLike(id, g.member.discordUserId);
  return NextResponse.json(await getCommentLikeSummary(id, g.member.discordUserId));
}
