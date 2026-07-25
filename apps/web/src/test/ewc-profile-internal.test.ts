import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  resolveGuild: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/ewc-profile-sync", () => ({
  syncEwcProfileForDiscordUser: mocks.sync,
}));
vi.mock("@/lib/guild", () => ({
  resolveDefaultGuildId: mocks.resolveGuild,
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitOr429: mocks.rateLimit,
}));

import { POST as syncProfile } from "@/app/api/internal/ewc-profile/sync/route";
import { POST as revalidateNews } from "@/app/api/internal/news/revalidate/route";

const PROFILE_SECRET = "p".repeat(64);
const NEWS_SECRET = "n".repeat(64);
const DISCORD_USER_ID = "200000000000000001";
const GUILD_ID = "900000000000000001";

function request({
  secret,
  body,
}: {
  secret?: string;
  body?: unknown;
}) {
  const headers = new Headers();
  if (secret) headers.set("x-ewc-internal-secret", secret);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request("http://localhost/api/internal/test", {
    method: "POST",
    headers,
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  process.env.EWC_DASHBOARD_INTERNAL_PROFILE_SYNC_SECRET = PROFILE_SECRET;
  process.env.EWC_DASHBOARD_INTERNAL_NEWS_REVALIDATE_SECRET = NEWS_SECRET;
  delete process.env.EWC_DASHBOARD_INTERNAL_SECRET;
  mocks.sync.mockReset().mockResolvedValue({ synced: true });
  mocks.resolveGuild.mockReset().mockResolvedValue(GUILD_ID);
  mocks.rateLimit.mockReset().mockResolvedValue(null);
});

describe("internal route capability boundary", () => {
  test("accepts only the matching credential for each route", async () => {
    const body = {
      discordUserId: DISCORD_USER_ID,
      guildId: GUILD_ID,
      season: "2026",
    };

    expect((await syncProfile(request({ secret: PROFILE_SECRET, body }))).status).toBe(200);
    expect((await syncProfile(request({ secret: NEWS_SECRET, body }))).status).toBe(401);
    expect((await revalidateNews(request({ secret: PROFILE_SECRET }))).status).toBe(401);
    expect((await revalidateNews(request({ secret: NEWS_SECRET }))).status).toBe(200);
  });

  test("returns the same 401 shape for missing, wrong, legacy, and malformed credentials", async () => {
    process.env.EWC_DASHBOARD_INTERNAL_SECRET = "l".repeat(64);
    const candidates = [undefined, "wrong", "l".repeat(64), "p".repeat(63)];
    const bodies = [];
    const capabilities = [];

    for (const secret of candidates) {
      const response = await syncProfile(request({ secret, body: "{not-json" }));
      expect(response.status).toBe(401);
      capabilities.push(response.headers.get("x-ec-internal-capability"));
      bodies.push(await json(response));
    }

    expect(bodies).toEqual(candidates.map(() => ({ error: "Unauthorized" })));
    expect(capabilities).toEqual(candidates.map(() => "profile-sync"));
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("rejects unknown fields and malformed values", async () => {
    const extra = await syncProfile(request({
      secret: PROFILE_SECRET,
      body: {
        discordUserId: DISCORD_USER_ID,
        guildId: GUILD_ID,
        season: "2026",
        downstreamUrl: "https://example.com",
      },
    }));
    expect(extra.status).toBe(400);

    const missingGuild = await syncProfile(request({
      secret: PROFILE_SECRET,
      body: { discordUserId: DISCORD_USER_ID, season: "2026" },
    }));
    expect(missingGuild.status).toBe(400);

    const array = await syncProfile(request({
      secret: PROFILE_SECRET,
      body: [DISCORD_USER_ID, GUILD_ID, "2026"],
    }));
    expect(array.status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("rejects an oversized authenticated payload before parsing it", async () => {
    const oversized = request({
      secret: PROFILE_SECRET,
      body: {
        discordUserId: DISCORD_USER_ID,
        guildId: GUILD_ID,
        season: "2026",
      },
    });
    oversized.headers.set("Content-Length", "9000");

    const response = await syncProfile(oversized);

    expect(response.status).toBe(413);
    await expect(json(response)).resolves.toEqual({ error: "Request body is too large." });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("pins the guild server-side and rejects another format-valid guild", async () => {
    const response = await syncProfile(request({
      secret: PROFILE_SECRET,
      body: {
        discordUserId: DISCORD_USER_ID,
        guildId: "900000000000000002",
        season: "2026",
      },
    }));

    expect(response.status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  test("syncs only the authenticated exact subject shape", async () => {
    const response = await syncProfile(request({
      secret: PROFILE_SECRET,
      body: {
        discordUserId: DISCORD_USER_ID,
        guildId: GUILD_ID,
        season: "2026",
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith({
      discordUserId: DISCORD_USER_ID,
      guildId: GUILD_ID,
      season: "2026",
    });
  });
});
