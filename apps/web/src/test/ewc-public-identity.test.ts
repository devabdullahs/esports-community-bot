import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/community", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community")>();
  return { ...actual, requireVerifiedMember: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { requireVerifiedMember } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { revalidateTag } from "next/cache";
import { DELETE, POST } from "@/app/api/me/ewc/public-identity/route";

const mockGate = vi.mocked(requireVerifiedMember);
const mockRateLimit = vi.mocked(rateLimitOr429);
const mockRevalidate = vi.mocked(revalidateTag);

const member = {
  authUserId: "auth-public-identity-web",
  discordUserId: "200000000000000601",
  displayName: "Current Server Name",
  avatarUrl: "https://cdn.discordapp.com/avatars/200000000000000601/avatar.png",
  inGuild: true,
  isVerified: true,
};

function request(method: "POST" | "DELETE", body?: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/me/ewc/public-identity", {
    method,
    headers: { Origin: origin, Host: "localhost", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seed() {
  const { upsertEwcProfileLink } = await import("@bot/db/ewcProfileLinks.js");
  await upsertEwcProfileLink({ ...member, guildId: "900000000000000601", season: "2026" });
}

describe("public prediction identity route", () => {
  beforeEach(async () => {
    await seed();
    mockGate.mockReset();
    mockRateLimit.mockReset();
    mockRevalidate.mockReset();
    mockRateLimit.mockResolvedValue(null);
    mockGate.mockResolvedValue({ member });
  });

  test("same-origin guard runs before the member gate", async () => {
    const response = await POST(request("POST", undefined, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(mockGate).not.toHaveBeenCalled();
  });

  test("ignores browser-supplied identity fields: the body is never read", async () => {
    // Hardened route (ECB-SEC-007): the request body is not parsed at all, so
    // spoofed fields cannot influence the stored identity — it always derives
    // from the authenticated account.
    const response = await POST(request("POST", { displayName: "Spoofed", discordUserId: "200000000000000699" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.displayName).toBe(member.displayName);
    expect(JSON.stringify(body)).not.toContain("Spoofed");
    const { getEwcProfileLinkByDiscordUser } = await import("@bot/db/ewcProfileLinks.js");
    const link = await getEwcProfileLinkByDiscordUser(member.discordUserId);
    expect(link?.publicDisplayName).toBe(member.displayName);
    // Reset for the following tests, which assume the anonymous default.
    const { DELETE } = await import("@/app/api/me/ewc/public-identity/route");
    await DELETE(request("DELETE"));
  });

  test("enables only the server-derived current name/avatar, returns no raw IDs, and invalidates public caches", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ enabled: true, displayName: member.displayName });
    expect(body.avatarUrl).toMatch(/^\/api\/ewc\/public-avatar\/[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain(member.discordUserId);
    expect(JSON.stringify(body)).not.toContain("cdn.discordapp.com");
    expect(mockRevalidate).toHaveBeenCalledWith("ewc-public-leaderboard", "default");
    expect(mockRevalidate).toHaveBeenCalledWith("ewc-predictions", "default");
  });

  test("allows an absent avatar but never accepts a non-Discord avatar source", async () => {
    mockGate.mockResolvedValue({ member: { ...member, avatarUrl: "https://evil.example/avatar.png" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect((await response.json()).avatarUrl).toBeNull();
  });

  test("disable clears the snapshot immediately without touching the profile link", async () => {
    await POST(request("POST"));
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, displayName: null, avatarUrl: null });
    const { getEwcProfileLinkByDiscordUser } = await import("@bot/db/ewcProfileLinks.js");
    const link = await getEwcProfileLinkByDiscordUser(member.discordUserId);
    expect(link?.guildId).toBe("900000000000000601");
    expect(link?.publicIdentityEnabled).toBe(false);
    expect(link?.publicAvatarUrl).toBeNull();
  });

  test("propagates blocked and rate-limited member outcomes", async () => {
    mockGate.mockResolvedValue({ response: NextResponse.json({ code: "unauthenticated" }, { status: 401 }) });
    expect((await POST(request("POST"))).status).toBe(401);
    mockGate.mockResolvedValue({ response: NextResponse.json({ code: "blocked" }, { status: 403 }) });
    expect((await POST(request("POST"))).status).toBe(403);
    mockGate.mockResolvedValue({ member });
    mockRateLimit.mockResolvedValue(NextResponse.json({ error: "Too many" }, { status: 429 }));
    expect((await POST(request("POST"))).status).toBe(429);
  });
});
