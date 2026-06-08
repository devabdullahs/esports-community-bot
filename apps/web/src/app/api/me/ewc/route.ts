import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { DEFAULT_SEASON } from "@/lib/env";
import { getEwcMePayload } from "@/lib/ewc-profile-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
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
