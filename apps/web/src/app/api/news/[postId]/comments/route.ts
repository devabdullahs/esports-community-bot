import { NextResponse } from "next/server";
import { getCommunityMember, requireVerifiedMember, sameOriginOr403, clientIp } from "@/lib/community";
import {
  createPostComment,
  getPostCommentsView,
  getPostLikeSummary,
} from "@/lib/comments";
import { parseId, validateCommentBody } from "@/lib/comment-validation";
import { getPublishedNewsPostCached } from "@/lib/news";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET is public: anyone can read the visible comment thread + post-like count.
export async function GET(_request: Request, context: { params: Promise<{ postId: string }> }) {
  const postId = parseId((await context.params).postId);
  if (postId === null) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  if (!(await getPublishedNewsPostCached(postId))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const { session, member } = await getCommunityMember();
  const viewerDiscordId = member?.discordUserId ?? null;
  const [comments, postLike] = await Promise.all([
    getPostCommentsView(postId, viewerDiscordId),
    getPostLikeSummary(postId, viewerDiscordId),
  ]);

  return NextResponse.json({
    comments,
    postLike,
    viewer: {
      signedIn: Boolean(session),
      verified: Boolean(member?.isVerified),
      inGuild: Boolean(member?.inGuild),
      discordUserId: viewerDiscordId,
      displayName: member?.displayName ?? null,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ postId: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const postId = parseId((await context.params).postId);
  if (postId === null) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const { member } = gate;

  if (!(await getPublishedNewsPostCached(postId))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // 5 comments / 10 min per user, plus a looser per-IP cap as an anti-abuse backstop.
  const userLimited = await rateLimitOr429({ key: `comment:create:${member.discordUserId}`, limit: 5, windowSec: 600 });
  if (userLimited) return userLimited;
  const ipLimited = await rateLimitOr429({ key: `comment:create:ip:${clientIp(request)}`, limit: 15, windowSec: 600 });
  if (ipLimited) return ipLimited;

  const body = await request.json().catch(() => ({}));
  const validated = validateCommentBody(body?.body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const parentCommentId = body?.parentCommentId != null ? parseId(String(body.parentCommentId)) : null;

  const result = await createPostComment({
    postId,
    parentCommentId,
    authUserId: member.authUserId,
    discordUserId: member.discordUserId,
    authorName: member.displayName ?? "",
    body: validated.body,
  });
  if ("error" in result) {
    return NextResponse.json({ error: "Reply target not found." }, { status: 400 });
  }
  return NextResponse.json(
    { comment: { id: Number(result.comment.id), status: result.comment.status } },
    { status: 201 },
  );
}
