import { NextResponse } from "next/server";
import { DEFAULT_SEASON } from "@/lib/env";
import { getEwcMePayload } from "@/lib/ewc-profile-sync";
import { getOptionalSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOptionalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const guildId = url.searchParams.get("guildId");
  const season = url.searchParams.get("season") || DEFAULT_SEASON;
  const payload = await getEwcMePayload({
    authUserId: session.user.id,
    guildId,
    season,
  });

  return NextResponse.json({
    user: session.user,
    ...payload,
  });
}
