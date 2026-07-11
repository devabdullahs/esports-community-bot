import { NextResponse } from "next/server";
import { getPublicEwcLeaderboardCached, isKnownEwcLeaderboardNamespace } from "@/lib/public-ewc-leaderboard";
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
  // Only namespaces with an existing prediction season may mint cache keys
  // or run the aggregate queries (ECB-SEC-003).
  if (!(await isKnownEwcLeaderboardNamespace(guildId, season))) {
    return NextResponse.json({ error: "Unknown guild or season." }, { status: 404 });
  }
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), { min: 1, max: 100, fallback: 50 });
  const offset = clampInt(url.searchParams.get("offset"), { min: 0, max: 100_000, fallback: 0 });
  // Cached (60s) — this endpoint is public and polled, so bound repeated aggregate
  // prediction queries. Keyed by guild/season/limit/offset.
  return NextResponse.json(await getPublicEwcLeaderboardCached({ guildId, season, limit, offset }));
}
