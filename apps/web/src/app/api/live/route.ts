import { NextResponse } from "next/server";
import { getLiveMatchCenter } from "@/lib/live-match-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This route reads only the short-lived public DB projection. It never asks a
// provider for fresh data; the bot's existing pollers remain the only writers.
export async function GET() {
  return NextResponse.json(await getLiveMatchCenter(), {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
    },
  });
}
