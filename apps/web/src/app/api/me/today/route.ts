import { NextResponse } from "next/server";
import { requireVerifiedMember } from "@/lib/community";
import { DEFAULT_SEASON } from "@/lib/env";
import { resolveDefaultGuildId } from "@/lib/guild";
import { getTodayForViewer } from "@/lib/today-for-you";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate.response;

  const guildId = await resolveDefaultGuildId();
  if (!guildId) {
    return NextResponse.json({ error: "Today overview unavailable." }, { status: 503 });
  }
  try {
    const payload = await getTodayForViewer(
      gate.member.discordUserId,
      guildId,
      DEFAULT_SEASON,
      Math.floor(Date.now() / 1000),
    );
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("[today-for-you] personalized overview unavailable");
    return NextResponse.json({ error: "Today overview unavailable." }, { status: 503 });
  }
}
