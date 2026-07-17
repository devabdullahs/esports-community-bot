import { castMvpVote, MvpVoteError } from "@bot/db/mvpVotes.js";
import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

function bodyShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "sessionId" && key !== "nomineeId")) return null;
  if (!Number.isSafeInteger(body.sessionId) || Number(body.sessionId) <= 0) return null;
  if (!Number.isSafeInteger(body.nomineeId) || Number(body.nomineeId) <= 0) return null;
  return { sessionId: Number(body.sessionId), nomineeId: Number(body.nomineeId) };
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const userLimit = await rateLimitOr429({ key: `mvp-vote:${gate.member.discordUserId}`, limit: 15, windowSec: 60 });
  if (userLimit) return userLimit;
  const ipLimit = await rateLimitOr429({ key: `mvp-vote-ip:${clientIp(request)}`, limit: 60, windowSec: 60 });
  if (ipLimit) return ipLimit;

  const parsed = await readBoundedJson(request, 1024);
  const body = parsed.ok ? bodyShape(parsed.value) : null;
  if (!body) return NextResponse.json({ error: "Invalid MVP vote request." }, { status: 400, headers });
  try {
    const vote = await castMvpVote({ ...body, discordUserId: gate.member.discordUserId });
    return NextResponse.json({ vote }, { headers });
  } catch (error) {
    if (error instanceof MvpVoteError) {
      const status = error.code === "not_found" ? 404 : error.code === "closed" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status, headers });
    }
    throw error;
  }
}
