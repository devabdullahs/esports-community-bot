import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/community", () => ({
  clientIp: vi.fn(() => "test-ip"),
  requireVerifiedMember: vi.fn(),
  sameOriginOr403: vi.fn(() => null),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/ewc-prediction-writes", () => ({
  mapPredictionWriteStatus: vi.fn((result: { code: string }) => result.code === "locked" ? 409 : 400),
  submitWebSeasonPick: vi.fn(),
  submitWebWeeklyPick: vi.fn(),
}));

import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import { submitWebSeasonPick, submitWebWeeklyPick } from "@/lib/ewc-prediction-writes";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { POST as weeklyPOST } from "@/app/api/me/ewc/picks/weekly/route";
import { POST as seasonPOST } from "@/app/api/me/ewc/picks/season/route";

const mockGate = vi.mocked(requireVerifiedMember);
const mockOrigin = vi.mocked(sameOriginOr403);
const mockLimit = vi.mocked(rateLimitOr429);
const mockWeekly = vi.mocked(submitWebWeeklyPick);
const mockSeason = vi.mocked(submitWebSeasonPick);

const member = {
  authUserId: "auth-member",
  discordUserId: "200000000000000001",
  displayName: "Member",
  avatarUrl: null,
  inGuild: true,
  isVerified: true,
};

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientIp).mockReturnValue("test-ip");
  mockOrigin.mockReturnValue(null);
  mockLimit.mockResolvedValue(null);
  mockGate.mockResolvedValue({ member });
  mockWeekly.mockResolvedValue({ ok: true, code: "saved", message: "saved", firstPick: true, completion: [] } as never);
  mockSeason.mockResolvedValue({ ok: true, code: "saved", message: "saved", firstPick: false, completion: [] } as never);
});

describe("web EWC prediction write routes", () => {
  test("returns the verified-member gate unchanged for anonymous, unverified, and blocked requests", async () => {
    for (const status of [401, 403, 403]) {
      mockGate.mockResolvedValueOnce({ response: new Response(null, { status }) } as never);
      expect((await weeklyPOST(request("/api/me/ewc/picks/weekly", { weekKey: "week", gameKey: "game", pick: "Falcons" }))).status).toBe(status);
    }
  });

  test("rejects a cross-origin request before reading the body", async () => {
    mockOrigin.mockReturnValue(new Response(null, { status: 403 }) as never);
    const response = await weeklyPOST(request("/api/me/ewc/picks/weekly", { weekKey: "week", gameKey: "game", pick: "Falcons" }));
    expect(response.status).toBe(403);
    expect(mockGate).not.toHaveBeenCalled();
  });

  test("rejects client-supplied identity, guild, season, timestamp, score, and unexpected fields", async () => {
    const response = await weeklyPOST(request("/api/me/ewc/picks/weekly", {
      weekKey: "week", gameKey: "game", pick: "Falcons", discordUserId: "other", guildId: "other", season: "2030", pickedAt: 1, score: 999,
    }));
    expect(response.status).toBe(400);
    expect(mockWeekly).not.toHaveBeenCalled();
  });

  test("enforces per-member and IP rate-limit checks with their Retry-After response", async () => {
    mockLimit.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "30" } }) as never);
    const response = await weeklyPOST(request("/api/me/ewc/picks/weekly", { weekKey: "week", gameKey: "game", pick: "Falcons" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mockWeekly).not.toHaveBeenCalled();
  });

  test("submits only the narrow weekly payload for the authenticated member", async () => {
    const response = await weeklyPOST(request("/api/me/ewc/picks/weekly", { weekKey: "week-one", gameKey: "valorant", pick: "Team Falcons" }));
    expect(response.status).toBe(200);
    expect(mockWeekly).toHaveBeenCalledWith(expect.objectContaining({ member, body: { weekKey: "week-one", gameKey: "valorant", pick: "Team Falcons" } }));
    await expect(response.json()).resolves.toMatchObject({ code: "saved", firstPick: true, actionableRounds: [] });
  });

  test("maps a trusted locked response to conflict and supports only closed season actions", async () => {
    mockWeekly.mockResolvedValueOnce({ ok: false, code: "locked", message: "locked" } as never);
    expect((await weeklyPOST(request("/api/me/ewc/picks/weekly", { weekKey: "week", gameKey: "game", pick: "Falcons" }))).status).toBe(409);

    const invalid = await seasonPOST(request("/api/me/ewc/picks/season", { action: "delete", index: 0 }));
    expect(invalid.status).toBe(400);
    const saved = await seasonPOST(request("/api/me/ewc/picks/season", { action: "swap", a: 0, b: 1 }));
    expect(saved.status).toBe(200);
    expect(mockSeason).toHaveBeenLastCalledWith(expect.objectContaining({ body: { action: "swap", a: 0, b: 1 } }));
  });
});
