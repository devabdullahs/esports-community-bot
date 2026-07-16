import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { getCommunityMember, requireVerifiedMember, sameOriginOr403, clientIp } from "@/lib/community";
import { createMatchComment, getTargetCommentsView } from "@/lib/comments";
import { parseId, validateCommentBody } from "@/lib/comment-validation";
import { getMatchPageModel } from "@/lib/match-details";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function matchExists(matchId: number) {
  // Match comments follow the same public visibility boundary as the match page:
  // active, single-guild matches only.
  return Boolean(await getMatchPageModel(matchId));
}

// GET is public: anyone can read a visible match thread. Comment likes and all
// comment-level actions stay on the established shared comment endpoints.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const matchId = parseId((await context.params).id);
  if (matchId === null) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });

  const ipLimited = await rateLimitOr429({ key: `comment:read:ip:${clientIp(request)}`, limit: 120, windowSec: 60 });
  if (ipLimited) return ipLimited;

  if (!(await matchExists(matchId))) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  const [{ session, member }, access] = await Promise.all([getCommunityMember(), getAdminAccess()]);
  const viewerDiscordId = member?.discordUserId ?? null;
  const canModerate = Boolean(access.allowed && access.discordUserId);
  const comments = await getTargetCommentsView("match", matchId, viewerDiscordId, { moderator: canModerate });

  return NextResponse.json({
    comments,
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const matchId = parseId((await context.params).id);
  if (matchId === null) return NextResponse.json({ error: "Invalid match id" }, { status: 400 });

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const { member } = gate;

  if (!(await matchExists(matchId))) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Intentionally share the news comment quotas: a member cannot evade the
  // community-wide abuse limits by switching targets.
  const userLimited = await rateLimitOr429({ key: `comment:create:${member.discordUserId}`, limit: 5, windowSec: 600 });
  if (userLimited) return userLimited;
  const ipLimited = await rateLimitOr429({ key: `comment:create:ip:${clientIp(request)}`, limit: 15, windowSec: 600 });
  if (ipLimited) return ipLimited;

  const body = await request.json().catch(() => ({}));
  const validated = validateCommentBody(body?.body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  let parentCommentId: number | null = null;
  if (body?.parentCommentId != null) {
    parentCommentId = parseId(String(body.parentCommentId));
    if (parentCommentId === null) {
      return NextResponse.json({ error: "Invalid reply target." }, { status: 400 });
    }
  }

  const result = await createMatchComment({
    matchId,
    parentCommentId,
    authUserId: member.authUserId,
    discordUserId: member.discordUserId,
    authorName: member.displayName ?? "",
    authorAvatarUrl: member.avatarUrl,
    body: validated.body,
  });
  if ("error" in result) {
    return NextResponse.json({ error: "You can't reply to this comment." }, { status: 400 });
  }
  return NextResponse.json(
    { comment: { id: Number(result.comment.id), status: result.comment.status } },
    { status: 201 },
  );
}
