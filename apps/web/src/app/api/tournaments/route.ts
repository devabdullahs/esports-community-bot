import { NextResponse } from "next/server";
import { listTournamentSummaries } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: one guild's competitive data, no PII — same auth posture as the
// public leaderboard route. Empty guild config yields { tournaments: [] }.
export async function GET() {
  return NextResponse.json({ tournaments: listTournamentSummaries() });
}
