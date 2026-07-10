import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { submitWebWeeklyPick, mapPredictionWriteStatus } from "@/lib/ewc-prediction-writes";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function exactWeeklyBody(value: unknown): { weekKey?: unknown; gameKey?: unknown; pick?: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["weekKey", "gameKey", "pick"].includes(key))) return null;
  return body;
}

export async function POST(request: Request) {
  // Capture before body parsing and all validation/resolution work. The shared
  // service rechecks this trusted timestamp inside its short transaction.
  const submittedAt = Math.floor(Date.now() / 1000);
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const member = gate.member;

  const memberLimit = await rateLimitOr429({ key: `ewc-pick-weekly:${member.discordUserId}`, limit: 12, windowSec: 60 });
  if (memberLimit) return memberLimit;
  const ipLimit = await rateLimitOr429({ key: `ewc-pick-weekly-ip:${clientIp(request)}`, limit: 60, windowSec: 60 });
  if (ipLimit) return ipLimit;

  const body = exactWeeklyBody(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Invalid prediction request.", code: "invalid_input" }, { status: 400 });

  const result = await submitWebWeeklyPick({ member, body, submittedAt });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: mapPredictionWriteStatus(result) });
  return NextResponse.json({ code: result.code, firstPick: Boolean(result.firstPick), actionableRounds: result.completion });
}
