import { NextResponse } from "next/server";
import { getViewerDiscordId } from "@/lib/follows";
import { getMatchCalendarForViewer } from "@/lib/match-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    const calendar = await getMatchCalendarForViewer(discordUserId, Math.floor(Date.now() / 1000));
    return NextResponse.json(calendar, { headers: privateHeaders });
  } catch {
    console.error("[match-calendar] personalized schedule unavailable");
    return NextResponse.json({ error: "Match calendar unavailable." }, { status: 503, headers: privateHeaders });
  }
}
