import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";
import { syncEwcProfileForDiscordUser } from "@/lib/ewc-profile-sync";
import { isSnowflake, isSeason } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (!isSnowflake(body.discordUserId)) {
    return NextResponse.json(
      { error: "discordUserId must be a Discord snowflake ID" },
      { status: 400 },
    );
  }
  if (body.guildId !== undefined && body.guildId !== null && !isSnowflake(body.guildId)) {
    return NextResponse.json({ error: "guildId must be a Discord snowflake ID" }, { status: 400 });
  }
  if (body.season !== undefined && body.season !== null && !isSeason(body.season)) {
    return NextResponse.json({ error: "season must be a 4-digit year" }, { status: 400 });
  }
  return NextResponse.json(
    await syncEwcProfileForDiscordUser({
      discordUserId: body.discordUserId,
      guildId: body.guildId,
      season: body.season,
    }),
  );
}
