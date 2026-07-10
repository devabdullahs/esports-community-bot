import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  getEwcProfileLinkByAuthUser,
  setEwcProfileLinkPublicIdentity,
} from "@bot/db/ewcProfileLinks.js";
import { requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { approvedDiscordAvatarUrl, normalizePublicDisplayName } from "@/lib/public-identity";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function noBrowserSuppliedIdentity(request: Request) {
  const body = await request.json().catch(() => null);
  return body === null || (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0);
}

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

export async function POST(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  if (!(await noBrowserSuppliedIdentity(request))) return NextResponse.json({ error: "Identity values are derived from your signed-in account." }, { status: 400 });
  const gate = await memberGate(request);
  if ("response" in gate) return gate.response;
  const displayName = normalizePublicDisplayName(gate.member.displayName);
  if (!displayName) return NextResponse.json({ error: "Your signed-in account does not have a display name to publish." }, { status: 400 });
  const link = await setEwcProfileLinkPublicIdentity({
    authUserId: gate.member.authUserId,
    discordUserId: gate.member.discordUserId,
    displayName,
    avatarUrl: approvedDiscordAvatarUrl(gate.member.avatarUrl),
  });
  if (!link) return NextResponse.json({ error: "Prediction profile link was not found." }, { status: 409 });
  invalidatePublicIdentityCaches();
  return NextResponse.json({ enabled: true, displayName: link.publicDisplayName, avatarUrl: link.publicAvatarToken ? `/api/ewc/public-avatar/${link.publicAvatarToken}` : null });
}

export async function DELETE(request: Request) {
  const origin = sameOriginOr403(request);
  if (origin) return origin;
  if (!(await noBrowserSuppliedIdentity(request))) return NextResponse.json({ error: "Identity values are derived from your signed-in account." }, { status: 400 });
  const gate = await memberGate(request);
  if ("response" in gate) return gate.response;
  const link = await setEwcProfileLinkPublicIdentity({
    authUserId: gate.member.authUserId,
    discordUserId: gate.member.discordUserId,
    displayName: null,
    avatarUrl: null,
  });
  if (!link) return NextResponse.json({ error: "Prediction profile link was not found." }, { status: 409 });
  invalidatePublicIdentityCaches();
  return NextResponse.json({ enabled: false, displayName: null, avatarUrl: null });
}
