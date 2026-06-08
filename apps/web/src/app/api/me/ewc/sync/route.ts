import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { DEFAULT_SEASON } from "@/lib/env";
import {
  getEwcMePayload,
  syncEwcProfileForAuthUser,
} from "@/lib/ewc-profile-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
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

  return NextResponse.json(
    await syncEwcProfileForAuthUser({
      authUserId: session.user.id,
      guildId,
      season,
    }),
  );
}
