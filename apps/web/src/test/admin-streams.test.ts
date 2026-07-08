process.env.EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS = "333456789012345678";

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(),
}));

vi.mock("@/lib/auth-database", () => ({
  getDiscordAccountForAuthUser: vi.fn(),
}));

import { getDiscordAccountForAuthUser } from "@/lib/auth-database";
import { getOptionalSession } from "@/lib/session";

const SUPER_ID = "333456789012345678";
const SCOPED_ID = "433456789012345678";

const mockSession = vi.mocked(getOptionalSession);
const mockDiscordAccount = vi.mocked(getDiscordAccountForAuthUser);
const { GET } = await import("@/app/api/admin/streams/route");

function fakeSession(authUserId: string) {
  const now = new Date();
  return {
    user: {
      id: authUserId,
      name: "Admin User",
      email: `${authUserId}@discord.local`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${authUserId}`,
      token: `session-${authUserId}`,
      userId: authUserId,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
}

function useAdmin(discordId: string) {
  mockSession.mockResolvedValue(fakeSession(`auth-${discordId}`) as never);
  mockDiscordAccount.mockResolvedValue({ accountId: discordId } as never);
}

describe("GET /api/admin/streams", () => {
  beforeAll(async () => {
    const admins = await import("@bot/db/ewcAdmins.js");
    await admins.upsertEwcAdmin({ discordId: SCOPED_ID, displayName: "Scoped Streams Admin" });
    await admins.setEwcAdminGameScopes(SCOPED_ID, ["valorant"]);
    await admins.setEwcAdminMediaScopes(SCOPED_ID, []);
  });

  beforeEach(() => {
    mockSession.mockReset();
    mockDiscordAccount.mockReset();
  });

  test("rejects scoped admins", async () => {
    useAdmin(SCOPED_ID);
    const response = await GET(new Request("http://localhost/api/admin/streams", {
      headers: { Host: "localhost" },
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Super admin only" });
  });

  test("allows super admins", async () => {
    useAdmin(SUPER_ID);
    const response = await GET(new Request("http://localhost/api/admin/streams", {
      headers: { Host: "localhost" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ channels: expect.any(Array) });
  });
});
