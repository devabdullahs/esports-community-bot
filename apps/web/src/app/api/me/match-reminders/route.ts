import { NextResponse } from "next/server";
import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { cancelMatchReminder, getMatchReminderTarget, upsertMatchReminder } from "@/lib/match-reminders";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_MAX_BODY_BYTES = 1024;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function exactReminderBody(value: unknown): { matchId?: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "matchId")) return null;
  return body;
}

async function getMatchId(request: Request): Promise<number | null> {
  const parsed = await readBoundedJson(request, REMINDER_MAX_BODY_BYTES);
  const body = parsed.ok ? exactReminderBody(parsed.value) : null;
  const matchId = body?.matchId;
  return typeof matchId === "number" && Number.isSafeInteger(matchId) && matchId > 0 ? matchId : null;
}

async function admitMutation(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return { response: origin, member: null };

  const gate = await requireVerifiedMember();
  if ("response" in gate) return { response: gate.response, member: null };

  const memberLimit = await rateLimitOr429({
    key: `match-reminder:${gate.member.discordUserId}`,
    limit: 30,
    windowSec: 60,
  });
  if (memberLimit) return { response: memberLimit, member: null };
  const ipLimit = await rateLimitOr429({
    key: `match-reminder-ip:${clientIp(request)}`,
    limit: 90,
    windowSec: 60,
  });
  if (ipLimit) return { response: ipLimit, member: null };

  return { response: null, member: gate.member };
}

export async function POST(request: Request) {
  const admitted = await admitMutation(request);
  if (admitted.response || !admitted.member) return admitted.response!;

  const matchId = await getMatchId(request);
  if (matchId === null) {
    return NextResponse.json({ error: "Invalid match reminder request." }, { status: 400, headers: privateHeaders });
  }
  const match = await getMatchReminderTarget(matchId);
  if (!match) return NextResponse.json({ error: "Match not found." }, { status: 404, headers: privateHeaders });
  if (match.status === "finished") {
    return NextResponse.json({ error: "Finished matches cannot be reminded." }, { status: 409, headers: privateHeaders });
  }

  const reminder = await upsertMatchReminder({ discordUserId: admitted.member.discordUserId, matchId });
  return NextResponse.json(
    { reminder: { matchId: reminder.match_id, createdAt: reminder.created_at } },
    { headers: privateHeaders },
  );
}

export async function DELETE(request: Request) {
  const admitted = await admitMutation(request);
  if (admitted.response || !admitted.member) return admitted.response!;

  const matchId = await getMatchId(request);
  if (matchId === null) {
    return NextResponse.json({ error: "Invalid match reminder request." }, { status: 400, headers: privateHeaders });
  }

  const match = await getMatchReminderTarget(matchId);
  if (!match) return NextResponse.json({ error: "Match not found." }, { status: 404, headers: privateHeaders });

  const reminder = await cancelMatchReminder({ discordUserId: admitted.member.discordUserId, matchId });
  return NextResponse.json({ removed: Boolean(reminder) }, { headers: privateHeaders });
}
