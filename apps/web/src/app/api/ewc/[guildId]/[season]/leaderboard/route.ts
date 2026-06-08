import { NextResponse } from "next/server";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ guildId: string; season: string }> },
) {
  const { guildId, season } = await context.params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 50);
  const offset = Number(url.searchParams.get("offset") || 0);
  return NextResponse.json(getPublicEwcLeaderboard({ guildId, season, limit, offset }));
}
