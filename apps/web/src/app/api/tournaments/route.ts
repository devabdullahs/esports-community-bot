import { NextResponse } from "next/server";
import { listTournamentSummariesCached } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: one guild's competitive data, no PII — same auth posture as the
// public leaderboard route. Empty guild config yields { tournaments: [] }.
// Cached (60s revalidate) on purpose: the public dashboard polls this, so serve
// from the cached helper to avoid repeated per-tournament count queries.
export async function GET() {
  return NextResponse.json({ tournaments: await listTournamentSummariesCached() });
}
