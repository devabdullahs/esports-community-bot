import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import {
  createViewerPredictionLeague,
  linkedPredictionLeagueContext,
  listViewerPredictionLeagues,
} from "@/lib/prediction-leagues";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;

async function contextForRequest() {
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate;
  const context = await linkedPredictionLeagueContext(gate.member);
  if (!context) {
    return {
      response: NextResponse.json(
        { error: "Link your verified Discord account to an active prediction profile first.", code: "profile_required" },
        { status: 409 },
      ),
    };
  }
  return { member: gate.member, context };
}

function validCreateBody(value: unknown): value is { name: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.name === "string";
}

export async function GET() {
  const gate = await contextForRequest();
  if ("response" in gate) return gate.response;
  return NextResponse.json({ leagues: await listViewerPredictionLeagues(gate.context) });
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const gate = await contextForRequest();
  if ("response" in gate) return gate.response;
  const memberLimit = await rateLimitOr429({ key: `prediction-league-create:${gate.member.discordUserId}`, limit: 6, windowSec: 600 });
  if (memberLimit) return memberLimit;
  const ipLimit = await rateLimitOr429({ key: `prediction-league-create-ip:${clientIp(request)}`, limit: 24, windowSec: 600 });
  if (ipLimit) return ipLimit;

  const parsed = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok || !validCreateBody(parsed.value)) {
    return NextResponse.json({ error: "Enter a valid league name." }, { status: 400 });
  }
  const result = await createViewerPredictionLeague(gate.context, parsed.value.name);
  if (!result.created) {
    return NextResponse.json({ error: "You have reached the mini-league limit." }, { status: 409 });
  }
  return NextResponse.json({ league: result.league }, { status: 201 });
}
