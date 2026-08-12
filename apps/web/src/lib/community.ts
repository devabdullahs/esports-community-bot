import "server-only";

import { NextResponse } from "next/server";
import {
  createRoleVerifier,
  type RoleVerification,
  type RoleVerifier,
} from "@/lib/discord-role-verification";
import { isUserBlocked } from "@bot/db/communityUserBlocks.js";
import type { Session } from "@/lib/auth";
import { getDiscordAccountForAuthUser } from "@/lib/auth-database";
import { devDiscordUserId, isDevAuthUser } from "@/lib/dev-auth";
import { getOptionalSession } from "@/lib/session";

// Community membership gate for comments/likes. Membership + the verified role are
// checked SERVER-SIDE via the bot token (the bot is already in the single guild),
// so no extra Discord OAuth scope is required and existing logins keep working.
// Frontend visibility is convenience only — every mutation re-checks here.

export type CommunityMember = {
  authUserId: string;
  discordUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  inGuild: boolean;
  isVerified: boolean;
};

function verifiedRoleIds(): Set<string> {
  return new Set(
    String(process.env.COMMUNITY_VERIFIED_ROLE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Guild-member roles come from a verifier that attaches an age and a provenance to the
// answer, so an upstream failure can no longer be mistaken for "still authorized". See
// discord-role-verification.ts for the decision table.
let verifier: RoleVerifier | null = null;
let verifierKey = "";

function roleVerifier(): RoleVerifier | null {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;
  // Rebuild if the configuration changed (tests set these per case).
  const key = `${guildId}:${token}`;
  if (!verifier || verifierKey !== key) {
    verifierKey = key;
    verifier = createRoleVerifier({
      guildId,
      token,
      onEvent: (event, statusClass) =>
        console.warn(JSON.stringify({ event, statusClass })),
    });
  }
  return verifier;
}

async function verifyMemberRoles(discordUserId: string): Promise<RoleVerification> {
  const instance = roleVerifier();
  // No bot credentials configured: verification is impossible, not "not a member".
  if (!instance) return { status: "unavailable" };
  return instance.verify(discordUserId);
}

export async function getCommunityMember(): Promise<{
  session: Session | null;
  member: CommunityMember | null;
  verification?: RoleVerification;
}> {
  const session = await getOptionalSession();
  if (!session) return { session: null, member: null };

  // Local dev-auth bypass user is treated as a verified member.
  if (isDevAuthUser(session.user.id)) {
    return {
      session,
      member: {
        authUserId: session.user.id,
        discordUserId: devDiscordUserId(),
        displayName: session.user.name ?? null,
        avatarUrl: session.user.image ?? null,
        inGuild: true,
        isVerified: true,
      },
    };
  }

  const account = await getDiscordAccountForAuthUser(session.user.id);
  const discordUserId = account?.accountId ?? null;
  if (!discordUserId) return { session, member: null };

  const verification = await verifyMemberRoles(discordUserId);
  // Unavailable is NOT "not in the guild". Read-only surfaces render the conservative
  // signed-in-but-unverified state; the mutation gate below turns it into a 503.
  const inGuild = verification.status === "verified";
  const verified = verifiedRoleIds();
  const isVerified =
    verification.status === "verified" && verification.roles.some((role) => verified.has(role));

  return {
    session,
    verification,
    member: {
      authUserId: session.user.id,
      discordUserId,
      displayName: session.user.name ?? null,
      avatarUrl: session.user.image ?? null,
      inGuild,
      isVerified,
    },
  };
}

export type RequireMemberResult =
  | { member: CommunityMember }
  | { response: NextResponse };

// Gate for mutation routes: 401 anonymous, 403 signed-in-but-unverified.
// The `code` lets the client show sign-in vs join/verify CTAs.
export async function requireVerifiedMember(): Promise<RequireMemberResult> {
  const { session, member, verification } = await getCommunityMember();
  if (!session) {
    return { response: NextResponse.json({ error: "Sign in to continue.", code: "unauthenticated" }, { status: 401 }) };
  }
  // Fail closed, and say so accurately: a 403 here would tell a member in good standing that
  // their membership was rejected, when in fact it could not be checked.
  if (verification?.status === "unavailable") {
    return {
      response: NextResponse.json(
        { error: "Membership could not be verified right now. Please try again shortly.", code: "verification-unavailable" },
        { status: 503 },
      ),
    };
  }
  if (!member || !member.isVerified) {
    const code = member?.inGuild ? "not-verified" : "not-member";
    return {
      response: NextResponse.json(
        { error: "Verified community membership is required.", code },
        { status: 403 },
      ),
    };
  }
  if (await isUserBlocked(member.discordUserId)) {
    return {
      response: NextResponse.json(
        { error: "Your access to community features has been suspended.", code: "blocked" },
        { status: 403 },
      ),
    };
  }
  return { member };
}

// Trusted client identity for IP-aware rate-limit keys (ECB-SEC-008/009/015/017).
//
// The proxy header is honored ONLY under an explicit deployment mode
// (EWC_TRUSTED_PROXY=cloudflare: cf-connecting-ip is
// written by the Cloudflare/CranL ingress and stripped from client input).
// x-forwarded-for / x-real-ip are never consulted — they are client-supplied.
// The header value must parse as a real IP: arbitrary strings previously
// became persistent rate-limit rows, handing attackers unlimited key
// cardinality AND a way to dodge the shared bucket. Invalid values now fail
// closed into one shared "invalid" bucket, and direct deployments
// (EWC_TRUSTED_PROXY=none) share one conservative "direct" bucket because the
// fetch Request API exposes no server-derived peer address.
// IPv6 keys are bucketed to the /64 prefix — one subscriber allocation — so a
// rotating interface identifier cannot mint fresh buckets.

function expandIpv6(value: string): string[] | null {
  const doubleColon = value.split("::");
  if (doubleColon.length > 2) return null;
  const head = doubleColon[0] ? doubleColon[0].split(":") : [];
  const tail = doubleColon.length === 2 && doubleColon[1] ? doubleColon[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (doubleColon.length === 2 && missing < 0) return null;
  if (doubleColon.length === 1 && head.length !== 8) return null;
  const groups =
    doubleColon.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.toLowerCase().padStart(4, "0"));
}

function canonicalClientIp(raw: string): string | null {
  let value = raw.trim();
  if (!value || value.length > 64) return null;
  // IPv4-mapped IPv6 (::ffff:203.0.113.9) canonicalizes to the IPv4 form.
  const mapped = value.toLowerCase().startsWith("::ffff:") ? value.slice(7) : null;
  if (mapped && /^\d{1,3}(\.\d{1,3}){3}$/.test(mapped)) value = mapped;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const octets = value.split(".").map(Number);
    return octets.every((o) => o >= 0 && o <= 255) ? octets.join(".") : null;
  }
  if (value.includes(":")) {
    const groups = expandIpv6(value);
    if (!groups) return null;
    return groups.slice(0, 4).join(":") + "::/64";
  }
  return null;
}

export function clientIp(request: Request): string {
  const mode = (process.env.EWC_TRUSTED_PROXY || "none").trim().toLowerCase();
  const shielded = (process.env.EWC_ORIGIN_SHIELDED || "").trim().toLowerCase() === "true";
  if (mode !== "cloudflare" || !shielded) return "direct";
  const raw = request.headers.get("cf-connecting-ip");
  if (!raw) return "direct";
  return canonicalClientIp(raw) ?? "invalid";
}

// Same-origin guard for state-changing requests: a browser sends Origin on
// POST/PATCH/DELETE/PUT, and for a same-origin call its host equals the request
// Host. Cross-site or Origin-less mutation attempts are rejected.
export function sameOriginOr403(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    if (new URL(origin).host !== host) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
