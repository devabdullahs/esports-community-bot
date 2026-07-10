// Set dev-bypass env vars before importing the routes that depend on them.
process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS = "true";
process.env.EWC_DASHBOARD_DEV_AUTH_USER_ID = "dev-ewc-sync-default";
process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID = "200000000000048100";

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(),
}));

import { getOptionalSession } from "@/lib/session";
const mockSession = vi.mocked(getOptionalSession);

import { GET as meGET, POST as mePOST } from "@/app/api/me/ewc/route";
import { POST as syncPOST } from "@/app/api/me/ewc/sync/route";
import { POST as unlinkPOST } from "@/app/api/me/ewc/unlink/route";

const SEASON = "2026";
const USERS = {
  get: { authUserId: "dev-ewc-get-user", discordUserId: "200000000000048101", guildId: "920000000000000101" },
  currentRound: { authUserId: "dev-ewc-round-user", discordUserId: "200000000000048106", guildId: "920000000000000106" },
  readOnlyGet: { authUserId: "dev-ewc-readonly-user", discordUserId: "200000000000048104", guildId: "920000000000000104" },
  link: { authUserId: "dev-ewc-link-user", discordUserId: "200000000000048105", guildId: "920000000000000105" },
  sync: { authUserId: "dev-ewc-sync-user", discordUserId: "200000000000048102", guildId: "920000000000000102" },
  unlink: { authUserId: "dev-ewc-unlink-user", discordUserId: "200000000000048103", guildId: "920000000000000103" },
  noAccount: { authUserId: "auth-without-discord-account" },
};

function fakeSession(authUserId: string, discordUserId: string) {
  const now = new Date();
  return {
    user: {
      id: authUserId,
      name: "Dev User",
      email: `${discordUserId}@discord.local`,
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

function useDevSession(authUserId: string, discordUserId: string): void {
  process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS = "true";
  process.env.EWC_DASHBOARD_DEV_AUTH_USER_ID = authUserId;
  process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID = discordUserId;
  mockSession.mockResolvedValue(fakeSession(authUserId, discordUserId) as never);
}

function useNonDevSession(authUserId: string): void {
  process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS = "true";
  process.env.EWC_DASHBOARD_DEV_AUTH_USER_ID = "different-dev-user";
  process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID = "200000000000048199";
  mockSession.mockResolvedValue(fakeSession(authUserId, "200000000000048198") as never);
}

function postReq(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedProfileLink({
  authUserId,
  discordUserId,
  guildId,
  season = SEASON,
}: {
  authUserId: string;
  discordUserId: string;
  guildId: string;
  season?: string;
}): Promise<void> {
  const { upsertEwcProfileLink } = await import("@bot/db/ewcProfileLinks.js");
  await upsertEwcProfileLink({ authUserId, discordUserId, guildId, season });
}

async function seedScoredWeek({
  guildId,
  userId,
  score,
}: {
  guildId: string;
  userId: string;
  score: number;
}): Promise<void> {
  const {
    saveWeeklyPredictionScore,
    upsertEwcWeek,
    upsertWeeklyPrediction,
  } = await import("@bot/db/ewcPredictions.js");

  const week = await upsertEwcWeek({
    guildId,
    season: SEASON,
    weekKey: `week-${userId.slice(-4)}`,
    label: "Week 1",
    createdBy: "web-test",
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: week.id,
    userId,
    picks: ["Team Falcons", "T1", "Gen.G"],
  });
  await saveWeeklyPredictionScore(guildId, week.id, userId, score, { total: score });
}

beforeEach(() => {
  mockSession.mockReset();
});

describe("EWC profile routes", () => {
  test("GET /api/me/ewc returns the linked guild, season, and stats", async () => {
    const user = USERS.get;
    useDevSession(user.authUserId, user.discordUserId);
    await seedProfileLink(user);
    await seedScoredWeek({ guildId: user.guildId, userId: user.discordUserId, score: 420 });

    const res = await meGET(new Request("http://localhost/api/me/ewc"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.user.id).toBe(user.authUserId);
    expect(body.discordUserId).toBe(user.discordUserId);
    expect(body.link.guildId).toBe(user.guildId);
    expect(body.link.season).toBe(SEASON);
    expect(body.stats).toMatchObject({
      guildId: user.guildId,
      season: SEASON,
      userId: user.discordUserId,
      overallPoints: 420,
      weeksPredicted: 1,
      weeksScored: 1,
    });
  });

  test("GET /api/me/ewc is read-only and does not create a profile link from query params", async () => {
    const user = USERS.readOnlyGet;
    useDevSession(user.authUserId, user.discordUserId);

    const res = await meGET(new Request(`http://localhost/api/me/ewc?guildId=${user.guildId}&season=${SEASON}`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.link).toBeNull();

    const { getEwcProfileLinkByDiscordUser } = await import("@bot/db/ewcProfileLinks.js");
    await expect(getEwcProfileLinkByDiscordUser(user.discordUserId)).resolves.toBeNull();
  });

  test("GET /api/me/ewc returns only the viewer's current-round pick progress", async () => {
    const user = USERS.currentRound;
    useDevSession(user.authUserId, user.discordUserId);
    await seedProfileLink(user);
    const now = Math.floor(Date.now() / 1000);
    const { upsertEwcWeek, upsertWeeklyGamePick } = await import("@bot/db/ewcPredictions.js");
    const week = await upsertEwcWeek({
      guildId: user.guildId,
      season: SEASON,
      weekKey: "current-round",
      label: "Current round",
      openAt: now - 60,
      closeAt: now + 3_600,
      games: [
        { key: "open-picked", game: "Valorant", lockAt: now + 1_800 },
        { key: "open-remaining", game: "Dota 2", lockAt: now + 2_400 },
        { key: "locked", game: "Chess", lockAt: now - 60 },
      ],
      createdBy: "web-test",
    });
    await upsertWeeklyGamePick({
      guildId: user.guildId,
      weekId: week.id,
      userId: user.discordUserId,
      gameKey: "open-picked",
      pick: "Team Falcons",
    });

    const res = await meGET(new Request("http://localhost/api/me/ewc"));
    const body = await res.json();
    expect(body.currentRound).toMatchObject({
      weekKey: "current-round",
      status: "partly open",
      openGames: 2,
      lockedGames: 1,
      totalGames: 3,
      pickedGames: 1,
      remainingGameKeys: ["open-remaining"],
      discordUrl: `https://discord.com/channels/${user.guildId}`,
    });
    expect(JSON.stringify(body.currentRound)).not.toContain("Team Falcons");
  });

  test("POST /api/me/ewc creates the profile link with a same-origin request", async () => {
    const user = USERS.link;
    useDevSession(user.authUserId, user.discordUserId);

    const res = await mePOST(postReq("http://localhost/api/me/ewc", { guildId: user.guildId, season: SEASON }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.link).toMatchObject({ guildId: user.guildId, season: SEASON });

    const { getEwcProfileLinkByDiscordUser } = await import("@bot/db/ewcProfileLinks.js");
    const link = await getEwcProfileLinkByDiscordUser(user.discordUserId);
    expect(link).toMatchObject({ guildId: user.guildId, season: SEASON });
  });

  test("POST /api/me/ewc rejects cross-site profile-link creation", async () => {
    const user = USERS.link;
    useDevSession(user.authUserId, user.discordUserId);

    const res = await mePOST(
      new Request("http://localhost/api/me/ewc", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example", Host: "localhost" },
        body: JSON.stringify({ guildId: user.guildId, season: SEASON }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("POST /api/me/ewc/sync marks the profile link as synced", async () => {
    const user = USERS.sync;
    useDevSession(user.authUserId, user.discordUserId);
    await seedProfileLink(user);

    const res = await syncPOST(
      postReq("http://localhost/api/me/ewc/sync", { guildId: user.guildId, season: SEASON }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.devBypass).toBe(true);
    expect(body.link.guildId).toBe(user.guildId);
    expect(body.link.season).toBe(SEASON);

    const { getEwcProfileLinkByDiscordUser } = await import("@bot/db/ewcProfileLinks.js");
    const link = await getEwcProfileLinkByDiscordUser(user.discordUserId);
    expect(link?.lastSyncedAt).toEqual(expect.any(String));
    expect(link?.lastSyncError).toBeNull();
  });

  test("POST /api/me/ewc/unlink removes the stored profile link", async () => {
    const user = USERS.unlink;
    useDevSession(user.authUserId, user.discordUserId);
    await seedProfileLink(user);

    const res = await unlinkPOST(postReq("http://localhost/api/me/ewc/unlink"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true, devBypass: true });

    const { getEwcProfileLinkByDiscordUser } = await import("@bot/db/ewcProfileLinks.js");
    await expect(getEwcProfileLinkByDiscordUser(user.discordUserId)).resolves.toBeNull();
  });

  test("POST /api/me/ewc/unlink returns deleted false when there is no Discord account", async () => {
    useNonDevSession(USERS.noAccount.authUserId);

    const res = await unlinkPOST(postReq("http://localhost/api/me/ewc/unlink"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: false });
  });
});
