import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { isPredictionLeagueId, leaveViewerPredictionLeague, linkedPredictionLeagueContext } from "@/lib/prediction-leagues";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ leagueId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const { leagueId } = await params;
  if (!isPredictionLeagueId(leagueId)) return NextResponse.json({ error: "Mini-league not found." }, { status: 404 });
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const context = await linkedPredictionLeagueContext(gate.member);
  if (!context) return NextResponse.json({ error: "Prediction profile required." }, { status: 409 });
  const memberLimit = await rateLimitOr429({ key: `prediction-league-leave:${gate.member.discordUserId}`, limit: 12, windowSec: 60 });
  if (memberLimit) return memberLimit;
  const ipLimit = await rateLimitOr429({ key: `prediction-league-leave-ip:${clientIp(request)}`, limit: 60, windowSec: 60 });
  if (ipLimit) return ipLimit;
  const result = await leaveViewerPredictionLeague(context, leagueId);
  if (result.left) return NextResponse.json({ left: true });
  if (result.reason === "owner_cannot_leave") {
    return NextResponse.json({ error: "Archive this mini-league instead of leaving it." }, { status: 409 });
  }
  return NextResponse.json({ error: "Mini-league not found." }, { status: 404 });
}
