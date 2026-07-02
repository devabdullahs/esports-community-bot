import { NextResponse } from "next/server";
import { sameOriginOr403 } from "@/lib/community";
import { getPrefs, getViewerDiscordId, upsertPrefs } from "@/lib/follows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const body = await request.json().catch(() => ({}));
  const patch: { dmEnabled?: boolean; notifyMatchStart?: boolean; notifyMatchResult?: boolean } = {};
  if (typeof body.dmEnabled === "boolean") patch.dmEnabled = body.dmEnabled;
  if (typeof body.notifyMatchStart === "boolean") patch.notifyMatchStart = body.notifyMatchStart;
  if (typeof body.notifyMatchResult === "boolean") patch.notifyMatchResult = body.notifyMatchResult;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const prefs = await upsertPrefs(discordUserId, patch);
  return NextResponse.json({ prefs });
}
