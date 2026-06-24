import { NextResponse } from "next/server";

// Permanent, shareable invite link: https://esportscommunity.net/discord
// 307 (temporary) keeps the redirect server-controlled so the target invite can be
// rotated later without browsers/proxies caching it. The invite itself is the
// community's non-expiring Discord code.
const DISCORD_INVITE_URL = "https://discord.gg/82k8RkFNpF";

export function GET() {
  return NextResponse.redirect(DISCORD_INVITE_URL, 307);
}
