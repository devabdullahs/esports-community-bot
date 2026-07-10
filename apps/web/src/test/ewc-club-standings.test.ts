import { beforeEach, describe, expect, test, vi } from "vitest";

const liquipedia = vi.hoisted(() => ({
  fetchEwcClubStandings: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock("@bot/services/liquipedia.js", () => liquipedia);

import { upsertEwcClubChampionshipSnapshot } from "@bot/db/ewcClubChampionshipSnapshots.js";
import {
  filterEwcClubStandings,
  projectEwcClubStandings,
  type EwcClubStandingCandidate,
} from "@/lib/ewc-club-standings";
import { getEwcClubTrackerCached } from "@/lib/ewc-clubs";

function candidate(
  name: string,
  rank: number | null,
  points: number | null,
  overrides: Partial<EwcClubStandingCandidate> = {},
): EwcClubStandingCandidate {
  return {
    name,
    rank,
    points,
    eligibility: null,
    region: "other",
    qualifiedGames: [],
    wins: [],
    ...overrides,
  };
}

beforeEach(() => {
  liquipedia.fetchEwcClubStandings.mockClear();
});

describe("EWC Club Championship standings", () => {
  test("orders by official rank before points, name, or featured status", () => {
    const rows = projectEwcClubStandings([
      candidate("Featured Third", 3, 9999, { featured: true, eligibility: "champion" }),
      candidate("Leader", 1, 100),
      candidate("Beta", 2, null, { eligibility: "not-a-real-state" }),
      candidate("Zulu", 2, 50, { eligibility: "prize" }),
      candidate("Alpha", 2, 50),
      candidate("Unranked", null, 20000),
      candidate("Directory only", null, null, { hasStanding: false }),
    ]);

    expect(rows.map((row) => row.name)).toEqual([
      "Leader",
      "Alpha",
      "Zulu",
      "Beta",
      "Featured Third",
      "Unranked",
    ]);
    expect(rows.map((row) => row.eligibility)).toEqual([null, null, "prize", null, "champion", null]);
    expect(rows.find((row) => row.name === "Beta")?.points).toBeNull();
  });

  test("search and region filters preserve the official row order", () => {
    const rows = projectEwcClubStandings([
      candidate("Falcons", 1, 100, { region: "gulf" }),
      candidate("Team Liquid", 2, 90, { region: "europe" }),
      candidate("Twisted Minds", 3, 80, { region: "gulf" }),
    ]);

    expect(filterEwcClubStandings(rows, { region: "gulf" }).map((row) => row.rank)).toEqual([1, 3]);
    expect(filterEwcClubStandings(rows, { q: "team liquid" }).map((row) => row.rank)).toEqual([2]);
  });

  test("a stored snapshot returns without touching a hanging Liquipedia fallback", async () => {
    await upsertEwcClubChampionshipSnapshot({
      season: "2198",
      sourceUrl: "https://liquipedia.net/esports/Esports_World_Cup/2198/Club_Championship_Standings",
      standings: [{ rank: 1, team: "Stored Snapshot Club", points: 321, eligibility: "champion" }],
      prizepool: [],
      fetchedAt: "2198-07-10T12:00:00.000Z",
    });

    const tracker = await Promise.race([
      getEwcClubTrackerCached(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("stored tracker timed out")), 500),
      ),
    ]);

    expect(tracker.dataSource).toBe("stored-snapshot");
    expect(tracker.clubs).toContainEqual(
      expect.objectContaining({ name: "Stored Snapshot Club", rank: 1, points: 321 }),
    );
    expect(liquipedia.fetchEwcClubStandings).not.toHaveBeenCalled();
  });
});
