import { NextResponse } from "next/server";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";
import { isSnowflake, isSeason, clampInt } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ guildId: string; season: string }> },
) {
  const { guildId, season } = await context.params;
  if (!isSnowflake(guildId) || !isSeason(season)) {
    return NextResponse.json({ error: "Invalid guild or season." }, { status: 400 });
  }
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), { min: 1, max: 100, fallback: 50 });
  const offset = clampInt(url.searchParams.get("offset"), { min: 0, max: 100_000, fallback: 0 });
  return NextResponse.json(await getPublicEwcLeaderboard({ guildId, season, limit, offset }));
}
