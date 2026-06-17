import { NextResponse } from "next/server";
import { isInternalRequestAuthorized } from "@/lib/internal-auth";
import { unlinkEwcProfileForDiscordUser } from "@/lib/ewc-profile-sync";
import { rateLimitOr429 } from "@/lib/rate-limit";
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
  const limited = await rateLimitOr429({ key: `ewc-internal-unlink:${body.discordUserId}`, limit: 10, windowSec: 60 });
  if (limited) return limited;

  return NextResponse.json(await unlinkEwcProfileForDiscordUser(body.discordUserId));
}
