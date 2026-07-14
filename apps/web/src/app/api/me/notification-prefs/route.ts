import { NextResponse } from "next/server";
import { sameOriginOr403 } from "@/lib/community";
import { getPrefs, getViewerDiscordId, upsertPrefs } from "@/lib/follows";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFS_MAX_BODY_BYTES = 4 * 1024;
const PREF_FIELDS = new Set([
  "dmEnabled",
  "notifyMatchStart",
  "notifyMatchResult",
  "dmDeliveryMode",
  "timezone",
  "quietStartMinute",
  "quietEndMinute",
  "digestMinute",
]);

function validMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 24 * 60;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefs = await getPrefs(discordUserId);
  return NextResponse.json({ prefs });
}

export async function PATCH(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  const discordUserId = await getViewerDiscordId();
  if (!discordUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimitOr429({ key: `notification-prefs:${discordUserId}`, limit: 30, windowSec: 60 });
  if (limited) return limited;

  const parsed = await readBoundedJson(request, PREFS_MAX_BODY_BYTES);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: "Invalid notification settings." }, { status: 400 });
  }
  const body = parsed.value as Record<string, unknown>;
  if (!Object.keys(body).every((field) => PREF_FIELDS.has(field))) {
    return NextResponse.json({ error: "Invalid notification settings." }, { status: 400 });
  }
  const patch: {
    dmEnabled?: boolean;
    notifyMatchStart?: boolean;
    notifyMatchResult?: boolean;
    dmDeliveryMode?: "instant" | "daily_digest";
    timezone?: string;
    quietStartMinute?: number | null;
    quietEndMinute?: number | null;
    digestMinute?: number;
  } = {};
  for (const field of ["dmEnabled", "notifyMatchStart", "notifyMatchResult"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") return NextResponse.json({ error: "Invalid notification settings." }, { status: 400 });
      patch[field] = body[field];
    }
  }
  if (body.dmDeliveryMode !== undefined) {
    if (body.dmDeliveryMode !== "instant" && body.dmDeliveryMode !== "daily_digest") {
      return NextResponse.json({ error: "Invalid notification settings." }, { status: 400 });
    }
    patch.dmDeliveryMode = body.dmDeliveryMode;
  }
  if (body.timezone !== undefined) {
    if (!validTimezone(body.timezone)) return NextResponse.json({ error: "Invalid notification settings." }, { status: 400 });
    patch.timezone = body.timezone;
  }
  const hasQuietStart = Object.hasOwn(body, "quietStartMinute");
  const hasQuietEnd = Object.hasOwn(body, "quietEndMinute");
  if (hasQuietStart !== hasQuietEnd) return NextResponse.json({ error: "Quiet hours require both boundaries." }, { status: 400 });
  if (hasQuietStart) {
    if ((body.quietStartMinute !== null && !validMinute(body.quietStartMinute)) ||
        (body.quietEndMinute !== null && !validMinute(body.quietEndMinute))) {
      return NextResponse.json({ error: "Invalid quiet hours." }, { status: 400 });
    }
    if ((body.quietStartMinute === null) !== (body.quietEndMinute === null)) {
      return NextResponse.json({ error: "Quiet hours require both boundaries." }, { status: 400 });
    }
    patch.quietStartMinute = body.quietStartMinute as number | null;
    patch.quietEndMinute = body.quietEndMinute as number | null;
  }
  if (body.digestMinute !== undefined) {
    if (!validMinute(body.digestMinute)) return NextResponse.json({ error: "Invalid digest time." }, { status: 400 });
    patch.digestMinute = body.digestMinute;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const prefs = await upsertPrefs(discordUserId, patch);
  return NextResponse.json({ prefs });
}
