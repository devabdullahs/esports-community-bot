import { NextResponse } from "next/server";
import { readPublicEwcLeaderboard } from "@/lib/public-ewc-leaderboard";
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
  // One operation owns admission and caching, so this route cannot forget the check the way
  // the public MCP tool did. Cached (60s) once admitted: this endpoint is public and polled.
  const result = await readPublicEwcLeaderboard({ guildId, season, limit, offset });
  if (result.status === "unknown-namespace") {
    return NextResponse.json({ error: "Unknown guild or season." }, { status: 404 });
  }
  return NextResponse.json(result.leaderboard);
}
