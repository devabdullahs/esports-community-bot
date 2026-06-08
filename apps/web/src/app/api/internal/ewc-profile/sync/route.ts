import { NextResponse } from "next/server";
import { internalSecret } from "@/lib/env";
import { syncEwcProfileForDiscordUser } from "@/lib/ewc-profile-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = internalSecret();
  if (!expected || request.headers.get("x-ewc-internal-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.discordUserId) {
    return NextResponse.json({ error: "discordUserId is required" }, { status: 400 });
  }
  return NextResponse.json(
    await syncEwcProfileForDiscordUser({
      discordUserId: body.discordUserId,
      guildId: body.guildId,
      season: body.season,
    }),
  );
}
