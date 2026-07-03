import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
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
export async function GET(request: Request, context: { params: Promise<{ postId: string }> }) {
  const postId = parseId((await context.params).postId);
  if (postId === null) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  // Light per-IP cap to prevent unauthenticated hammering.
  const ipLimited = await rateLimitOr429({ key: `comment:read:ip:${clientIp(request)}`, limit: 120, windowSec: 60 });
  if (ipLimited) return ipLimited;

  if (!(await getPublishedNewsPostCached(postId))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const [{ session, member }, access] = await Promise.all([getCommunityMember(), getAdminAccess()]);
  const viewerDiscordId = member?.discordUserId ?? null;
  // A moderator (super or scoped admin) sees hidden/rejected/reported comments
  // inline with report counts and can act on them without leaving the page.
  const canModerate = Boolean(access.allowed && access.discordUserId);
  const [comments, postLike] = await Promise.all([
    getPostCommentsView(postId, viewerDiscordId, { moderator: canModerate }),
    getPostLikeSummary(postId, viewerDiscordId),
  ]);

  return NextResponse.json({
    comments,
    postLike,
    viewer: {
      signedIn: Boolean(session),
      verified: Boolean(member?.isVerified),
      inGuild: Boolean(member?.inGuild),
      canModerate,
      discordUserId: viewerDiscordId,
      displayName: member?.displayName ?? null,
      avatarUrl: member?.avatarUrl ?? null,
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

  // A present-but-invalid parentCommentId is a client error — never silently fall
  // back to creating a root comment.
  let parentCommentId: number | null = null;
  if (body?.parentCommentId != null) {
    parentCommentId = parseId(String(body.parentCommentId));
    if (parentCommentId === null) {
      return NextResponse.json({ error: "Invalid reply target." }, { status: 400 });
    }
  }

  const result = await createPostComment({
    postId,
    parentCommentId,
    authUserId: member.authUserId,
    discordUserId: member.discordUserId,
    authorName: member.displayName ?? "",
    authorAvatarUrl: member.avatarUrl,
    body: validated.body,
  });
  if ("error" in result) {
    // Keep the public message generic for both missing and non-interactable parents.
    return NextResponse.json({ error: "You can't reply to this comment." }, { status: 400 });
  }
  return NextResponse.json(
    { comment: { id: Number(result.comment.id), status: result.comment.status } },
    { status: 201 },
  );
}
