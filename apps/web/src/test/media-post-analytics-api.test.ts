import { describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, mediaAdmin, nonAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});
vi.mock("@/lib/web-analytics", () => ({ getPostAnalytics: vi.fn() }));

import { GET } from "@/app/api/admin/analytics/posts/route";
import { getAdminAccess } from "@/lib/admin";
import { getPostAnalytics } from "@/lib/web-analytics";

const mockAccess = vi.mocked(getAdminAccess);
const mockAnalytics = vi.mocked(getPostAnalytics);
const privateVisitor = "visitor-api-private-id";

const aggregate = {
  generatedAt: 1_800_000_000,
  timezone: "Asia/Riyadh",
  days: 30,
  since: 1_797_494_400,
  totals: { pageviews: 2, visitors: 1, sessions: 1, engagementSeconds: 20, avgSecondsPerSession: 20, avgSecondsPerPageview: 10 },
  posts: [{ postId: 8, publishedAt: null, pageviews: 2, visitors: 1, sessions: 1, engagementSeconds: 20, avgSecondsPerSession: 20, avgSecondsPerPageview: 10 }],
  countries: [],
  acquisition: [],
  campaigns: [],
  daily: [],
};

function request(query = "") {
  return new Request(`http://localhost/api/admin/analytics/posts${query}`);
}

describe("post analytics API scope", () => {
  test("rejects anonymous and unassigned users", async () => {
    mockAccess.mockResolvedValue(anonymous());
    expect((await GET(request("?media=alpha"))).status).toBe(401);

    mockAccess.mockResolvedValue(nonAdmin());
    expect((await GET(request("?media=alpha"))).status).toBe(403);
  });

  test("prevents a media admin from requesting another channel", async () => {
    mockAccess.mockResolvedValue(mediaAdmin(["alpha"]));
    mockAnalytics.mockClear();

    const response = await GET(request("?media=bravo"));

    expect(response.status).toBe(403);
    expect(mockAnalytics).not.toHaveBeenCalled();
  });

  test("permits assigned media and game scopes, returning aggregate-only data", async () => {
    mockAnalytics.mockResolvedValue(aggregate);
    mockAccess.mockResolvedValue(mediaAdmin(["alpha"]));

    const mediaResponse = await GET(request("?media=alpha&days=14"));
    expect(mediaResponse.status).toBe(200);
    expect(mediaResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(mockAnalytics).toHaveBeenLastCalledWith({ mediaSlug: "alpha", gameSlug: null, days: 14 });
    const mediaBody = await mediaResponse.text();
    expect(mediaBody).not.toContain(privateVisitor);
    expect(mediaBody).not.toContain("session_id");

    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    const gameResponse = await GET(request("?game=valorant"));
    expect(gameResponse.status).toBe(200);
    expect(mockAnalytics).toHaveBeenLastCalledWith({ mediaSlug: null, gameSlug: "valorant" });
  });

  test("allows a super admin to request the full published-post comparison", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    mockAnalytics.mockResolvedValue(aggregate);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockAnalytics).toHaveBeenLastCalledWith({ mediaSlug: null, gameSlug: null });
  });
});
