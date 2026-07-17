import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/community", () => ({
  clientIp: vi.fn(() => "test-ip"),
  requireVerifiedMember: vi.fn(),
  sameOriginOr403: vi.fn(() => null),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/prediction-leagues", () => ({
  archiveViewerPredictionLeague: vi.fn(),
  createViewerPredictionLeague: vi.fn(),
  isPredictionLeagueId: vi.fn((value: string) => value === "11111111-1111-4111-8111-111111111111"),
  joinViewerPredictionLeague: vi.fn(),
  leaveViewerPredictionLeague: vi.fn(),
  linkedPredictionLeagueContext: vi.fn(),
  listViewerPredictionLeagues: vi.fn(),
  viewerPredictionLeagueDetail: vi.fn(),
}));

import { clientIp, requireVerifiedMember, sameOriginOr403 } from "@/lib/community";
import {
  archiveViewerPredictionLeague,
  createViewerPredictionLeague,
  joinViewerPredictionLeague,
  leaveViewerPredictionLeague,
  linkedPredictionLeagueContext,
  listViewerPredictionLeagues,
  viewerPredictionLeagueDetail,
} from "@/lib/prediction-leagues";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { DELETE as archiveDELETE, GET as detailGET } from "@/app/api/me/prediction-leagues/[leagueId]/route";
import { POST as joinPOST } from "@/app/api/me/prediction-leagues/join/route";
import { POST as leavePOST } from "@/app/api/me/prediction-leagues/[leagueId]/leave/route";
import { GET as listGET, POST as createPOST } from "@/app/api/me/prediction-leagues/route";

const LEAGUE_ID = "11111111-1111-4111-8111-111111111111";
const member = {
  authUserId: "auth-mini-league-member",
  discordUserId: "200000000000000701",
  displayName: "Member",
  avatarUrl: null,
  inGuild: true,
  isVerified: true,
};
const context = { guildId: "900000000000000701", season: "2026", discordUserId: member.discordUserId };
const league = { id: LEAGUE_ID, name: "Falcons Friends", memberCount: 2, isOwner: true, inviteCode: "A".repeat(32), createdAt: "2026-07-17 10:00:00" };

function request(path: string, method: "POST" | "DELETE", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeContext() {
  return { params: Promise.resolve({ leagueId: LEAGUE_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientIp).mockReturnValue("test-ip");
  vi.mocked(sameOriginOr403).mockReturnValue(null);
  vi.mocked(rateLimitOr429).mockResolvedValue(null);
  vi.mocked(requireVerifiedMember).mockResolvedValue({ member });
  vi.mocked(linkedPredictionLeagueContext).mockResolvedValue(context);
  vi.mocked(listViewerPredictionLeagues).mockResolvedValue([league]);
  vi.mocked(createViewerPredictionLeague).mockResolvedValue({ created: true, reason: null, league });
  vi.mocked(joinViewerPredictionLeague).mockResolvedValue({ joined: true, reason: null, league });
  vi.mocked(viewerPredictionLeagueDetail).mockResolvedValue({ league, leaderboard: [{ rank: 1, score: 100, displayName: "Member" }] });
  vi.mocked(leaveViewerPredictionLeague).mockResolvedValue({ left: true, reason: null });
  vi.mocked(archiveViewerPredictionLeague).mockResolvedValue(true);
});

describe("prediction mini-league routes", () => {
  test("lists only the authenticated viewer's leagues and preserves the member gate", async () => {
    await expect((await listGET()).json()).resolves.toEqual({ leagues: [league] });
    expect(listViewerPredictionLeagues).toHaveBeenCalledWith(context);

    vi.mocked(requireVerifiedMember).mockResolvedValueOnce({ response: new Response(null, { status: 401 }) } as never);
    expect((await listGET()).status).toBe(401);
  });

  test("checks same origin before create and accepts only a narrow bounded create payload", async () => {
    vi.mocked(sameOriginOr403).mockReturnValueOnce(new Response(null, { status: 403 }) as never);
    expect((await createPOST(request("/api/me/prediction-leagues", "POST", { name: "Friends" }))).status).toBe(403);
    expect(requireVerifiedMember).not.toHaveBeenCalled();

    const invalid = await createPOST(request("/api/me/prediction-leagues", "POST", { name: "Friends", ownerUserId: "other" }));
    expect(invalid.status).toBe(400);
    expect(createViewerPredictionLeague).not.toHaveBeenCalled();

    const created = await createPOST(request("/api/me/prediction-leagues", "POST", { name: "Friends" }));
    expect(created.status).toBe(201);
    expect(createViewerPredictionLeague).toHaveBeenCalledWith(context, "Friends");
  });

  test("enforces member and IP rate limits for invite joins", async () => {
    vi.mocked(rateLimitOr429).mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "30" } }) as never);
    const limited = await joinPOST(request("/api/me/prediction-leagues/join", "POST", { inviteCode: "A".repeat(32) }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    expect(joinViewerPredictionLeague).not.toHaveBeenCalled();

    const joined = await joinPOST(request("/api/me/prediction-leagues/join", "POST", { inviteCode: "A".repeat(32) }));
    expect(joined.status).toBe(200);
    expect(joinViewerPredictionLeague).toHaveBeenCalledWith(context, "A".repeat(32));
  });

  test("does not reveal unscoped league details and restricts lifecycle actions to their adapter results", async () => {
    vi.mocked(viewerPredictionLeagueDetail).mockResolvedValueOnce(null);
    expect((await detailGET(new Request(`http://localhost/api/me/prediction-leagues/${LEAGUE_ID}`), routeContext())).status).toBe(404);

    vi.mocked(archiveViewerPredictionLeague).mockResolvedValueOnce(false);
    expect((await archiveDELETE(request(`/api/me/prediction-leagues/${LEAGUE_ID}`, "DELETE"), routeContext())).status).toBe(404);

    vi.mocked(leaveViewerPredictionLeague).mockResolvedValueOnce({ left: false, reason: "owner_cannot_leave" });
    expect((await leavePOST(request(`/api/me/prediction-leagues/${LEAGUE_ID}/leave`, "POST"), routeContext())).status).toBe(409);
  });
});
