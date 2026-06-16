import { NextResponse } from "next/server";
import { requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { getPostLikeSummary, removePostLike, setPostLike } from "@/lib/comments";
import { parseId } from "@/lib/comment-validation";
import { getPublishedNewsPostCached } from "@/lib/news";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gateAndLimit(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return { response: origin };
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate;
  const limited = await rateLimitOr429({ key: `like:${gate.member.discordUserId}`, limit: 60, windowSec: 60 });
  if (limited) return { response: limited };
  return gate;
}

export async function PUT(request: Request, context: { params: Promise<{ postId: string }> }) {
  const postId = parseId((await context.params).postId);
  if (postId === null) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  const gate = await gateAndLimit(request);
  if ("response" in gate) return gate.response;
  if (!(await getPublishedNewsPostCached(postId))) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  await setPostLike(postId, gate.member.discordUserId);
  return NextResponse.json(await getPostLikeSummary(postId, gate.member.discordUserId));
}

export async function DELETE(request: Request, context: { params: Promise<{ postId: string }> }) {
  const postId = parseId((await context.params).postId);
  if (postId === null) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  const gate = await gateAndLimit(request);
  if ("response" in gate) return gate.response;
  if (!(await getPublishedNewsPostCached(postId))) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  await removePostLike(postId, gate.member.discordUserId);
  return NextResponse.json(await getPostLikeSummary(postId, gate.member.discordUserId));
}
