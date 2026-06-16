import "server-only";

import { NextResponse } from "next/server";
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

// Short in-process cache of guild-member roles to avoid hitting Discord on every
// mutation (mutations are also DB-rate-limited, so this stays well under limits).
const ROLE_CACHE_TTL_MS = 60_000;
const roleCache = new Map<string, { roles: string[] | null; at: number }>();

async function fetchMemberRoles(discordUserId: string): Promise<string[] | null> {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) return null;

  const cached = roleCache.get(discordUserId);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.roles;

  let roles: string[] | null;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      { headers: { Authorization: `Bot ${token}` } },
    );
    if (res.status === 404) roles = null; // not a member of the guild
    else if (!res.ok) throw new Error(`Discord member fetch failed (${res.status})`);
    else {
      const member = (await res.json()) as { roles?: string[] };
      roles = Array.isArray(member.roles) ? member.roles : [];
    }
  } catch {
    // On a transient Discord error, fall back to the last cached value if any,
    // else treat as not-verifiable (fail closed for the gate).
    return cached?.roles ?? null;
  }
  roleCache.set(discordUserId, { roles, at: Date.now() });
  return roles;
}

export async function getCommunityMember(): Promise<{
  session: Session | null;
  member: CommunityMember | null;
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
        inGuild: true,
        isVerified: true,
      },
    };
  }

  const account = await getDiscordAccountForAuthUser(session.user.id);
  const discordUserId = account?.accountId ?? null;
  if (!discordUserId) return { session, member: null };

  const roles = await fetchMemberRoles(discordUserId);
  const inGuild = roles !== null;
  const verified = verifiedRoleIds();
  const isVerified = inGuild && roles!.some((r) => verified.has(r));

  return {
    session,
    member: {
      authUserId: session.user.id,
      discordUserId,
      displayName: session.user.name ?? null,
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
  const { session, member } = await getCommunityMember();
  if (!session) {
    return { response: NextResponse.json({ error: "Sign in to continue.", code: "unauthenticated" }, { status: 401 }) };
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
  return { member };
}

// Best-effort client IP for IP-aware rate-limit keys (behind Cloudflare).
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
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
