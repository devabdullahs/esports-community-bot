import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/community", () => ({ requireVerifiedMember: vi.fn() }));
vi.mock("@/lib/guild", () => ({ resolveDefaultGuildId: vi.fn() }));
vi.mock("@/lib/today-for-you", () => ({ getTodayForViewer: vi.fn() }));

import { requireVerifiedMember } from "@/lib/community";
import { resolveDefaultGuildId } from "@/lib/guild";
import { getTodayForViewer } from "@/lib/today-for-you";
import { GET } from "@/app/api/me/today/route";

const member = {
  authUserId: "auth-user",
  discordUserId: "200000000000099001",
  displayName: "Member",
  avatarUrl: null,
  inGuild: true,
  isVerified: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireVerifiedMember).mockResolvedValue({ member });
  vi.mocked(resolveDefaultGuildId).mockResolvedValue("200000000000099002");
  vi.mocked(getTodayForViewer).mockResolvedValue({
    liveMatches: [],
    upcomingMatches: [],
    unreadNotifications: [],
    actionableRounds: [],
    coStreams: { available: true, items: [] },
    counts: { follows: 0, unreadNotifications: 0, actionableRounds: 0 },
    hrefs: {
      following: "/me?tab=following",
      notifications: "/me?tab=notifications",
      predictions: "/me?tab=predictions",
      games: "/games",
      tournaments: "/tournaments",
      coStreams: "/co-streams",
    },
  });
});

describe("GET /api/me/today", () => {
  test("returns the verified-member gate unchanged for signed-out and blocked viewers", async () => {
    for (const status of [401, 403]) {
      vi.mocked(requireVerifiedMember).mockResolvedValueOnce({ response: new Response(null, { status }) } as never);
      expect((await GET()).status).toBe(status);
    }
    expect(getTodayForViewer).not.toHaveBeenCalled();
  });

  test("derives the member identity, guild, and season server-side", async () => {
    const response = await (GET as unknown as (request: Request) => Promise<Response>)(
      new Request("http://localhost/api/me/today?discordUserId=another-user&guildId=another-guild"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getTodayForViewer).toHaveBeenCalledWith(
      member.discordUserId,
      "200000000000099002",
      "2026",
      expect.any(Number),
    );
    await expect(response.json()).resolves.toMatchObject({ counts: { follows: 0 } });
  });

  test("fails closed when the personalized aggregate cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTodayForViewer).mockRejectedValueOnce(new Error("database details"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Today overview unavailable." });
    error.mockRestore();
  });
});
