import { NextResponse } from "next/server";
import { DEFAULT_SEASON } from "@/lib/env";
import { getEwcMePayload } from "@/lib/ewc-profile-sync";
import { getOptionalSession } from "@/lib/session";
import { isSnowflake, isSeason } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOptionalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const guildId = url.searchParams.get("guildId");
  const seasonParam = url.searchParams.get("season");

  if (guildId !== null && !isSnowflake(guildId)) {
    return NextResponse.json({ error: "Invalid guildId." }, { status: 400 });
  }
  if (seasonParam !== null && !isSeason(seasonParam)) {
    return NextResponse.json({ error: "Invalid season." }, { status: 400 });
  }

  const season = seasonParam || DEFAULT_SEASON;
  const payload = await getEwcMePayload({
    authUserId: session.user.id,
    guildId,
    season,
  });

  return NextResponse.json({
    user: { id: session.user.id, name: session.user.name, image: session.user.image ?? null },
    ...payload,
  });
}
