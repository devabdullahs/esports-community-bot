import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import {
  archiveViewerPredictionLeague,
  isPredictionLeagueId,
  linkedPredictionLeagueContext,
  viewerPredictionLeagueDetail,
} from "@/lib/prediction-leagues";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ leagueId: string }> };

async function viewerContext() {
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate;
  const context = await linkedPredictionLeagueContext(gate.member);
  if (!context) return { response: NextResponse.json({ error: "Prediction profile required." }, { status: 409 }) };
  return { member: gate.member, context };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { leagueId } = await params;
  if (!isPredictionLeagueId(leagueId)) return NextResponse.json({ error: "Mini-league not found." }, { status: 404 });
  const gate = await viewerContext();
  if ("response" in gate) return gate.response;
  const detail = await viewerPredictionLeagueDetail(gate.context, leagueId);
  if (!detail) return NextResponse.json({ error: "Mini-league not found." }, { status: 404 });
  return NextResponse.json(detail);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const { leagueId } = await params;
  if (!isPredictionLeagueId(leagueId)) return NextResponse.json({ error: "Mini-league not found." }, { status: 404 });
  const gate = await viewerContext();
  if ("response" in gate) return gate.response;
  const memberLimit = await rateLimitOr429({ key: `prediction-league-archive:${gate.member.discordUserId}`, limit: 6, windowSec: 600 });
  if (memberLimit) return memberLimit;
  const ipLimit = await rateLimitOr429({ key: `prediction-league-archive-ip:${clientIp(request)}`, limit: 24, windowSec: 600 });
  if (ipLimit) return ipLimit;
  const archived = await archiveViewerPredictionLeague(gate.context, leagueId);
  if (!archived) return NextResponse.json({ error: "Mini-league not found." }, { status: 404 });
  return NextResponse.json({ archived: true });
}
