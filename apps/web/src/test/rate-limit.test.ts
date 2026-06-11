/**
 * Rate-limit tests for /api/me/ewc/sync and /api/me/ewc/unlink.
 *
 * Strategy:
 *  - Set dev-bypass env vars BEFORE any imports so isDevAuthUser() returns true.
 *  - Mock @/lib/session to return a dev-bypass session (avoids headers()/auth calls).
 *  - Seed a profile link so sync has a guild to work with.
 *  - Assert 200 for allowed calls, 429 + Retry-After + friendly message for the blocked call.
 */

// Set dev-bypass env vars first — must be before any module that reads them.
process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS = "true";
process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID = "200000000000000001";
// devAuthUserId() defaults to "dev-local-auth-user" — use that as the session user id.
const DEV_USER_ID = "dev-local-auth-user";
const DEV_DISCORD_ID = "200000000000000001";
const GUILD_ID = "900000000000000001";
const SEASON = "2026";

import { beforeAll, describe, expect, test, vi } from "vitest";

// Mock session BEFORE route imports so the factory picks up the mock.
vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(),
}));

import { getOptionalSession } from "@/lib/session";
const mockSession = vi.mocked(getOptionalSession);

// Build a fake session matching the dev-bypass user id.
function fakeSession() {
  const now = new Date();
  return {
    user: {
      id: DEV_USER_ID,
      name: "Dev User",
      email: `${DEV_DISCORD_ID}@discord.local`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: "dev-local-session",
      token: "dev-local-session",
      userId: DEV_USER_ID,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
}

// Seed a profile link so sync finds a guild.
async function seedProfileLink() {
  const { upsertEwcProfileLink } = await import("@bot/db/ewcProfileLinks.js");
  (upsertEwcProfileLink as (p: { authUserId: string; discordUserId: string; guildId: string; season: string }) => unknown)({
    authUserId: DEV_USER_ID,
    discordUserId: DEV_DISCORD_ID,
    guildId: GUILD_ID,
    season: SEASON,
  });
}

// Route handlers — imported after mocks are in place.
import { POST as syncPOST } from "@/app/api/me/ewc/sync/route";
import { POST as unlinkPOST } from "@/app/api/me/ewc/unlink/route";

// ---- Sync rate-limit suite -----------------------------------------------

describe("sync route rate limit (3 per 5 min)", () => {
  beforeAll(async () => {
    await seedProfileLink();
    mockSession.mockResolvedValue(fakeSession() as never);
  });

  function syncReq() {
    return new Request("http://localhost/api/me/ewc/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID, season: SEASON }),
    });
  }

  test("call 1 → 200", async () => {
    const res = await syncPOST(syncReq());
    expect(res.status).toBe(200);
  });

  test("call 2 → 200", async () => {
    const res = await syncPOST(syncReq());
    expect(res.status).toBe(200);
  });

  test("call 3 → 200", async () => {
    const res = await syncPOST(syncReq());
    expect(res.status).toBe(200);
  });

  test("call 4 → 429 with Retry-After and friendly message", async () => {
    const res = await syncPOST(syncReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/too many requests/i);
  });
});

// ---- Unlink rate-limit suite -----------------------------------------------

describe("unlink route rate limit (2 per 10 min)", () => {
  beforeAll(async () => {
    // Re-seed so unlink has something to delete each time (or doesn't throw).
    await seedProfileLink();
    mockSession.mockResolvedValue(fakeSession() as never);
  });

  function unlinkReq() {
    return new Request("http://localhost/api/me/ewc/unlink", { method: "POST" });
  }

  test("call 1 → 200", async () => {
    // Re-seed so unlink can succeed.
    await seedProfileLink();
    const res = await unlinkPOST(unlinkReq());
    expect(res.status).toBe(200);
  });

  test("call 2 → 200", async () => {
    await seedProfileLink();
    const res = await unlinkPOST(unlinkReq());
    expect(res.status).toBe(200);
  });

  test("call 3 → 429 with Retry-After and friendly message", async () => {
    const res = await unlinkPOST(unlinkReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/too many requests/i);
  });
});
