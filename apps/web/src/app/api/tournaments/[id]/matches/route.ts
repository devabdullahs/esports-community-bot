import { NextResponse } from "next/server";
import { getTournamentMatchesCached } from "@/lib/tournaments";
import { clampInt } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: matches for one tournament, grouped live/upcoming/finished.
// `id` must be a positive integer (the bot helper looks tournaments up by id).
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid tournament id." }, { status: 400 });
  }
  const tournamentId = Number(id);
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    return NextResponse.json({ error: "Invalid tournament id." }, { status: 400 });
  }

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), { min: 1, max: 200, fallback: 50 });
  const offset = clampInt(url.searchParams.get("offset"), { min: 0, max: 100_000, fallback: 0 });

  // Cached (60s revalidate); the match list polls every ~90s. unstable_cache keys
  // by (id, limit, offset), so paginated and per-tournament reads stay distinct.
  const data = await getTournamentMatchesCached(tournamentId, { limit, offset });
  if (!data) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  return NextResponse.json(data);
}
