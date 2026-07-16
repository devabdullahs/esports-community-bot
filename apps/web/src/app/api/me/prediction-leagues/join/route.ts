import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { joinViewerPredictionLeague, linkedPredictionLeagueContext } from "@/lib/prediction-leagues";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validJoinBody(value: unknown): value is { inviteCode: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.inviteCode === "string";
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const context = await linkedPredictionLeagueContext(gate.member);
  if (!context) {
    return NextResponse.json({ error: "Link your verified Discord account to an active prediction profile first." }, { status: 409 });
  }
  const memberLimit = await rateLimitOr429({ key: `prediction-league-join:${gate.member.discordUserId}`, limit: 12, windowSec: 60 });
  if (memberLimit) return memberLimit;
  const ipLimit = await rateLimitOr429({ key: `prediction-league-join-ip:${clientIp(request)}`, limit: 60, windowSec: 60 });
  if (ipLimit) return ipLimit;

  const parsed = await readBoundedJson(request, 4 * 1024);
  if (!parsed.ok || !validJoinBody(parsed.value)) {
    return NextResponse.json({ error: "Enter a valid invite code." }, { status: 400 });
  }
  const result = await joinViewerPredictionLeague(context, parsed.value.inviteCode);
  if (result.joined || result.reason === "already_member") {
    return NextResponse.json({ league: result.league, joined: result.joined });
  }
  if (result.reason === "league_full" || result.reason === "league_limit") {
    return NextResponse.json({ error: result.reason === "league_full" ? "This mini-league is full." : "You have reached the mini-league limit." }, { status: 409 });
  }
  return NextResponse.json({ error: "Invalid invite code." }, { status: 404 });
}
