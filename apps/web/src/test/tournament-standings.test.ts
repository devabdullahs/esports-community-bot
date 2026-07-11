import { describe, expect, test } from "vitest";
import {
  ewcPlacementPointsForRank,
  finalTournamentStandingSection,
} from "@/lib/tournament-standings";

describe("completed EWC tournament standings", () => {
  test("promotes the semantic final section over later preliminary fields", () => {
    const rows = [
      { section: "Group Stage: A vs B", rank: 1 },
      { section: "Finals: Grand Final", rank: 1 },
      { section: "Survivor Stage", rank: 1 },
    ];
    expect(finalTournamentStandingSection(rows)).toBe("Finals: Grand Final");
  });

  test("falls back to the last standings field when no final label exists", () => {
    expect(finalTournamentStandingSection([
      { section: "Round 1", rank: 1 },
      { section: "Round 2", rank: 1 },
    ])).toBe("Round 2");
  });

  test("maps official EWC placement points through eighth place", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(ewcPlacementPointsForRank)).toEqual([
      1000, 750, 500, 300, 200, 150, 100, 50, 0,
    ]);
  });
});
