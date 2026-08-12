/**
 * One shared-gate integration case for plan 149: when Discord verification is unavailable,
 * every member-only mutation must fail closed with 503 rather than authorize from a stale
 * role array or claim the member was rejected. The state machine itself is covered by
 * community-role-cache.test.ts; this proves the gate consumes it correctly.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const SYNTHETIC_AUTH_USER = "auth-user-synthetic";
const SYNTHETIC_DISCORD_USER = "900000000000000042";
const SYNTHETIC_GUILD = "900000000000000001";
const SYNTHETIC_TOKEN = "SYNTHETIC-BOT-TOKEN-NEVER-REAL";

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(async () => ({ user: { id: SYNTHETIC_AUTH_USER, name: "Member", image: null } })),
}));
vi.mock("@/lib/auth-database", () => ({
  getDiscordAccountForAuthUser: vi.fn(async () => ({ accountId: SYNTHETIC_DISCORD_USER })),
}));
vi.mock("@bot/db/communityUserBlocks.js", () => ({
  isUserBlocked: vi.fn(async () => false),
}));

const { requireVerifiedMember } = await import("@/lib/community");

describe("member mutation gate when Discord verification is unavailable", () => {
  beforeEach(() => {
    process.env.DISCORD_GUILD_ID = SYNTHETIC_GUILD;
    process.env.DISCORD_TOKEN = SYNTHETIC_TOKEN;
  });

  test("returns 503 verification-unavailable and never yields a member to write with", async () => {
    // No cached success exists, so there is nothing to grace from: the only safe answer is
    // that membership could not be checked.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("discord unreachable"));

    const result = await requireVerifiedMember();

    expect("response" in result).toBe(true);
    if (!("response" in result)) throw new Error("gate must not authorize");
    expect(result.response.status).toBe(503);
    const body = await result.response.json();
    expect(body.code).toBe("verification-unavailable");
    // A route only reaches its write when the gate returns a member, so an absent member is
    // the structural proof that no mutation can run.
    expect("member" in result).toBe(false);
    // Nothing about the upstream failure, the token, or the user may leak to the client.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SYNTHETIC_TOKEN);
    expect(serialized).not.toContain(SYNTHETIC_DISCORD_USER);
    expect(serialized).not.toContain("discord unreachable");
  });

  test("a definitive non-member still gets 403, not the unavailable code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));

    const result = await requireVerifiedMember();

    expect("response" in result).toBe(true);
    if (!("response" in result)) throw new Error("gate must not authorize");
    expect(result.response.status).toBe(403);
    expect((await result.response.json()).code).toBe("not-member");
  });
});
