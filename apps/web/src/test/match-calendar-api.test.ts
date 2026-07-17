import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/follows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/follows")>();
  return { ...actual, getViewerDiscordId: vi.fn() };
});
vi.mock("@/lib/match-calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/match-calendar")>();
  return { ...actual, getMatchCalendarForViewer: vi.fn() };
});

import { getViewerDiscordId } from "@/lib/follows";
import { getMatchCalendarForViewer } from "@/lib/match-calendar";
import { GET as getCalendar } from "@/app/api/me/calendar/route";
import { GET as getIcs } from "@/app/api/me/calendar/ics/route";

const viewerId = "200000000000099001";
const calendar = {
  matches: [
    {
      id: 42,
      tournamentId: 5,
      tournamentName: "Cup; One",
      game: "Valorant",
      teamA: "Team, Falcons",
      teamB: "Team Liquid",
      scheduledAt: 1_800_000_000,
    },
  ],
  window: { startsAt: 1_800_000_000, endsAt: 1_802_592_000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getViewerDiscordId).mockResolvedValue(viewerId);
  vi.mocked(getMatchCalendarForViewer).mockResolvedValue(calendar);
});

describe("match calendar API", () => {
  test("rejects anonymous requests before reading a private calendar", async () => {
    vi.mocked(getViewerDiscordId).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const jsonResponse = await getCalendar();
    const icsResponse = await getIcs(new Request("http://localhost/api/me/calendar/ics"));

    expect(jsonResponse.status).toBe(401);
    expect(icsResponse.status).toBe(401);
    expect(jsonResponse.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getMatchCalendarForViewer).not.toHaveBeenCalled();
  });

  test("derives the viewer server-side and returns only the private schedule projection", async () => {
    const response = await getCalendar();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(getMatchCalendarForViewer).toHaveBeenCalledWith(viewerId, expect.any(Number));
    await expect(response.json()).resolves.toEqual(calendar);
  });

  test("returns a valid private ICS export and scopes a single-match download to the viewer schedule", async () => {
    const response = await getIcs(new Request("http://localhost/api/me/calendar/ics?match=42"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("esports-community-match-42.ics");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.text()).resolves.toContain("UID:match-42@esports-community-bot");

    const inaccessible = await getIcs(new Request("http://localhost/api/me/calendar/ics?match=999"));
    expect(inaccessible.status).toBe(404);
    await expect(inaccessible.json()).resolves.toEqual({ error: "Match is not in your calendar." });
  });
});
