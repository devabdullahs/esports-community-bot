import { NextResponse } from "next/server";
import { getViewerDiscordId } from "@/lib/follows";
import { getMatchCalendarForViewer, serializeMatchCalendarIcs, type CalendarMatch } from "@/lib/match-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function requestedMatches(request: Request, matches: CalendarMatch[]) {
  const values = new URL(request.url).searchParams.getAll("match");
  if (!values.length) return { matches, matchId: null };
  if (values.length !== 1 || !/^\d{1,15}$/.test(values[0])) return { error: "Invalid match id.", status: 400 };
  const matchId = Number(values[0]);
  if (!Number.isSafeInteger(matchId)) return { error: "Invalid match id.", status: 400 };
  const match = matches.find((item) => item.id === matchId);
  if (!match) return { error: "Match is not in your calendar.", status: 404 };
  return { matches: [match], matchId };
}

export async function GET(request: Request) {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  }
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const calendar = await getMatchCalendarForViewer(discordUserId, nowSec);
    const selected = requestedMatches(request, calendar.matches);
    if ("error" in selected) {
      return NextResponse.json({ error: selected.error }, { status: selected.status, headers: privateHeaders });
    }
    const filename = selected.matchId === null
      ? "esports-community-matches.ics"
      : `esports-community-match-${selected.matchId}.ics`;
    return new NextResponse(serializeMatchCalendarIcs(selected.matches, nowSec), {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    console.error("[match-calendar] iCal export unavailable");
    return NextResponse.json({ error: "Match calendar unavailable." }, { status: 503, headers: privateHeaders });
  }
}
