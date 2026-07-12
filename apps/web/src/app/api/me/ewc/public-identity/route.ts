import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getEwcProfileLinkByAuthUser } from "@bot/db/ewcProfileLinks.js";
import { requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalidatePublicIdentityCaches() {
  revalidateTag("ewc-public-leaderboard", "default");
  revalidateTag("ewc-predictions", "default");
}

async function memberGate(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return { response: origin };
  const gate = await requireVerifiedMember();
  if ("response" in gate) return gate;
  const limited = await rateLimitOr429({ key: `ewc-public-identity:${gate.member.discordUserId}`, limit: 5, windowSec: 600 });
  if (limited) return { response: limited };
  const link = await getEwcProfileLinkByAuthUser(gate.member.authUserId);
  if (!link || link.discordUserId !== gate.member.discordUserId) {
    return { response: NextResponse.json({ error: "Link your verified Discord prediction profile first." }, { status: 409 }) };
  }
  return { member: gate.member, link };
}

// Kept for compatibility with older clients. Predictor identities are now
// public by default, so POST only refreshes public projections.
export async function POST(request: Request) {
  const gate = await memberGate(request);
  if ("response" in gate) return gate.response;
  invalidatePublicIdentityCaches();
  return NextResponse.json({ enabled: true });
}

export async function DELETE(request: Request) {
  const gate = await memberGate(request);
  if ("response" in gate) return gate.response;
  return NextResponse.json(
    { error: "Predictor identities are public." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
