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

function request(method: "POST" | "DELETE", origin = "http://localhost") {
  return new Request("http://localhost/api/me/ewc/public-identity", {
    method,
    headers: { Origin: origin, Host: "localhost" },
  });
}

describe("public prediction identity compatibility route", () => {
  beforeEach(async () => {
    const { upsertEwcProfileLink } = await import("@bot/db/ewcProfileLinks.js");
    await upsertEwcProfileLink({ ...member, guildId: "900000000000000601", season: "2026" });
    mockGate.mockReset();
    mockRateLimit.mockReset();
    mockRevalidate.mockReset();
    mockRateLimit.mockResolvedValue(null);
    mockGate.mockResolvedValue({ member });
  });

  test("same-origin guard runs before authentication", async () => {
    expect((await POST(request("POST", "https://evil.example"))).status).toBe(403);
    expect(mockGate).not.toHaveBeenCalled();
  });

  test("legacy enable requests remain idempotent and invalidate public caches", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
    expect(mockRevalidate).toHaveBeenCalledWith("ewc-public-leaderboard", "default");
    expect(mockRevalidate).toHaveBeenCalledWith("ewc-predictions", "default");
  });

  test("anonymous mode cannot be re-enabled through the legacy endpoint", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "Predictor identities are public." });
  });

  test("propagates blocked and rate-limited outcomes", async () => {
    mockGate.mockResolvedValue({ response: NextResponse.json({ code: "blocked" }, { status: 403 }) });
    expect((await POST(request("POST"))).status).toBe(403);
    mockGate.mockResolvedValue({ member });
    mockRateLimit.mockResolvedValue(NextResponse.json({ error: "Too many" }, { status: 429 }));
    expect((await POST(request("POST"))).status).toBe(429);
  });
});
