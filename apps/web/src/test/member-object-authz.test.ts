process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS = "true";
process.env.EWC_DASHBOARD_DEV_AUTH_USER_ID = "member-object-viewer";
process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID = "200000000000049101";
process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = "920000000000009100";

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(),
}));

vi.mock("@/lib/community", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community")>();
  return {
    ...actual,
    requireVerifiedMember: vi.fn(),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimitOr429: vi.fn(async () => null),
}));

import { requireVerifiedMember } from "@/lib/community";
import { getOptionalSession } from "@/lib/session";
import { POST as unlinkPOST } from "@/app/api/me/ewc/unlink/route";
import {
  DELETE as leagueDELETE,
  GET as leagueGET,
} from "@/app/api/me/prediction-leagues/[leagueId]/route";
import { POST as leagueLeavePOST } from "@/app/api/me/prediction-leagues/[leagueId]/leave/route";

const GUILD_ID = "920000000000009100";
const SEASON = "2026";
const viewer = {
  authUserId: "member-object-viewer",
  discordUserId: "200000000000049101",
};
const neighbor = {
  authUserId: "member-object-neighbor",
  discordUserId: "200000000000049102",
};

function fakeSession(authUserId: string) {
  const now = new Date();
  return {
    user: {
      id: authUserId,
      name: "Viewer",
      email: `${authUserId}@example.invalid`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${authUserId}`,
      token: `token-${authUserId}`,
      userId: authUserId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
}

function mutationRequest(path: string, method: "POST" | "DELETE", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Host: "localhost",
      Origin: "http://localhost",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function leagueContext(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.EWC_DASHBOARD_DEV_AUTH_BYPASS = "true";
  process.env.EWC_DASHBOARD_DEV_AUTH_USER_ID = viewer.authUserId;
  process.env.EWC_DASHBOARD_DEV_DISCORD_USER_ID = viewer.discordUserId;
  process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = GUILD_ID;

  vi.mocked(getOptionalSession).mockResolvedValue(fakeSession(viewer.authUserId) as never);
  vi.mocked(requireVerifiedMember).mockResolvedValue({
    member: {
      authUserId: viewer.authUserId,
      discordUserId: viewer.discordUserId,
      displayName: "Viewer",
      avatarUrl: null,
      inGuild: true,
      isVerified: true,
    },
  });

  const { upsertEwcProfileLink } = await import("@bot/db/ewcProfileLinks.js");
  await upsertEwcProfileLink({
    authUserId: viewer.authUserId,
    discordUserId: viewer.discordUserId,
    guildId: GUILD_ID,
    season: SEASON,
  });
  await upsertEwcProfileLink({
    authUserId: neighbor.authUserId,
    discordUserId: neighbor.discordUserId,
    guildId: GUILD_ID,
    season: SEASON,
  });
});

describe("member object authorization", () => {
  test("profile unlink ignores caller-selected identity and leaves a neighboring profile linked", async () => {
    const response = await unlinkPOST(
      mutationRequest("/api/me/ewc/unlink", "POST", {
        authUserId: neighbor.authUserId,
        discordUserId: neighbor.discordUserId,
      }),
    );
    expect(response.status).toBe(200);

    const {
      getEwcProfileLinkByAuthUser,
      getEwcProfileLinkByDiscordUser,
    } = await import("@bot/db/ewcProfileLinks.js");
    await expect(getEwcProfileLinkByAuthUser(viewer.authUserId)).resolves.toBeNull();
    await expect(getEwcProfileLinkByDiscordUser(viewer.discordUserId)).resolves.toBeNull();
    await expect(getEwcProfileLinkByAuthUser(neighbor.authUserId)).resolves.toMatchObject({
      authUserId: neighbor.authUserId,
      discordUserId: neighbor.discordUserId,
    });
  });

  test("known neighboring mini-league IDs remain unreadable and immutable", async () => {
    const { createPredictionLeague, getPredictionLeagueForMember } = await import(
      "@bot/db/ewcPredictionLeagues.js"
    );
    const own = await createPredictionLeague({
      guildId: GUILD_ID,
      season: SEASON,
      ownerUserId: viewer.discordUserId,
      name: "Viewer league",
    });
    const neighboring = await createPredictionLeague({
      guildId: GUILD_ID,
      season: SEASON,
      ownerUserId: neighbor.discordUserId,
      name: "Neighbor league",
    });
    expect(own.league?.id).toEqual(expect.any(String));
    expect(neighboring.league?.id).toEqual(expect.any(String));

    const ownId = own.league!.id;
    const neighboringId = neighboring.league!.id;
    expect(
      (
        await leagueGET(
          new Request(`http://localhost/api/me/prediction-leagues/${ownId}`),
          leagueContext(ownId),
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await leagueGET(
          new Request(`http://localhost/api/me/prediction-leagues/${neighboringId}`),
          leagueContext(neighboringId),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await leagueDELETE(
          mutationRequest(`/api/me/prediction-leagues/${neighboringId}`, "DELETE"),
          leagueContext(neighboringId),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await leagueLeavePOST(
          mutationRequest(`/api/me/prediction-leagues/${neighboringId}/leave`, "POST"),
          leagueContext(neighboringId),
        )
      ).status,
    ).toBe(404);

    await expect(
      getPredictionLeagueForMember({
        guildId: GUILD_ID,
        season: SEASON,
        userId: neighbor.discordUserId,
        leagueId: neighboringId,
      }),
    ).resolves.toMatchObject({
      id: neighboringId,
      isOwner: true,
    });

    expect(
      (
        await leagueDELETE(
          mutationRequest(`/api/me/prediction-leagues/${ownId}`, "DELETE"),
          leagueContext(ownId),
        )
      ).status,
    ).toBe(200);
  });
});
