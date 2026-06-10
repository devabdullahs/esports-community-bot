import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";
import { unlinkEwcProfileForDiscordUser } from "@/lib/ewc-profile-sync";
import { isSnowflake } from "@/lib/validate";

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
  return NextResponse.json(await unlinkEwcProfileForDiscordUser(body.discordUserId));
}
