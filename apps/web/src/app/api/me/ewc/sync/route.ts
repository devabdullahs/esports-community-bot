import { NextResponse } from "next/server";
import { DEFAULT_SEASON } from "@/lib/env";
import {
  getEwcMePayload,
  syncEwcProfileForAuthUser,
} from "@/lib/ewc-profile-sync";
import { sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { getOptionalSession } from "@/lib/session";
import { isSnowflake, isSeason } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;

  const session = await getOptionalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimitOr429({ key: `ewc-sync:${session.user.id}`, limit: 3, windowSec: 300 });
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));

  if (body.guildId !== undefined && body.guildId !== null && !isSnowflake(body.guildId)) {
    return NextResponse.json({ error: "Invalid guildId." }, { status: 400 });
  }
  if (body.season !== undefined && body.season !== null && !isSeason(body.season)) {
    return NextResponse.json({ error: "Invalid season." }, { status: 400 });
  }

  const current = await getEwcMePayload({
    authUserId: session.user.id,
    guildId: body.guildId,
    season: body.season,
  });
  const guildId = body.guildId || current.link?.guildId;
  const season = body.season || current.link?.season || DEFAULT_SEASON;
  if (!guildId) {
    return NextResponse.json({ error: "Choose a guild from a Discord link first." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await syncEwcProfileForAuthUser({
        authUserId: session.user.id,
        guildId,
        season,
      }),
    );
  } catch (error) {
    const err = error as Error & { retryAfterSec?: number };
    if (err.retryAfterSec !== undefined) {
      const retry = Math.max(1, err.retryAfterSec);
      return NextResponse.json(
        { error: `Discord is rate limiting profile updates — try again in ${retry} seconds.` },
        { status: 429, headers: { "Retry-After": String(retry) } },
      );
    }
    return NextResponse.json({ error: "Profile sync failed — try again later." }, { status: 502 });
  }
}
