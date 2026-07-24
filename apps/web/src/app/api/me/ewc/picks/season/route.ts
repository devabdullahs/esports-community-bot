import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { submitWebSeasonPick, mapPredictionWriteStatus } from "@/lib/ewc-prediction-writes";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson, requestBodyErrorResponse } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SEASON_PICK_BODY_MAX_BYTES = 8 * 1024;

function exactSeasonBody(value: unknown): { action?: unknown; index?: unknown; a?: unknown; b?: unknown; pick?: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["action", "index", "a", "b", "pick"].includes(key))) return null;
  if (body.action === "set" && Number.isInteger(body.index) && typeof body.pick === "string" && body.a === undefined && body.b === undefined) return body;
  if (body.action === "swap" && Number.isInteger(body.a) && Number.isInteger(body.b) && body.index === undefined && body.pick === undefined) return body;
  return null;
}

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;
  const member = gate.member;

  const memberLimit = await rateLimitOr429({ key: `ewc-pick-season:${member.discordUserId}`, limit: 12, windowSec: 60 });
  if (memberLimit) return memberLimit;
  const ipLimit = await rateLimitOr429({ key: `ewc-pick-season-ip:${clientIp(request)}`, limit: 60, windowSec: 60 });
  if (ipLimit) return ipLimit;

  const parsed = await readBoundedJson<unknown>(request, SEASON_PICK_BODY_MAX_BYTES);
  if (!parsed.ok) return requestBodyErrorResponse(parsed.reason);
  const body = exactSeasonBody(parsed.value);
  if (!body) return NextResponse.json({ error: "Invalid prediction request.", code: "invalid_input" }, { status: 400 });

  const submittedAt = Math.floor(Date.now() / 1000);
  const result = await submitWebSeasonPick({ member, body, submittedAt });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: mapPredictionWriteStatus(result) });
  return NextResponse.json({ code: result.code, firstPick: Boolean(result.firstPick), actionableRounds: result.completion });
}
