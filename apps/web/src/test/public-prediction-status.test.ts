import { describe, expect, it } from "vitest";
import { selectPublicPredictionStatus } from "@/lib/public-prediction-status";

const NOW = 2_000;

function week(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    week_key: "week-1",
    label: "Week 1",
    status: "open",
    open_at: 1_000,
    close_at: 3_000,
    score_after: 4_000,
    games: [
      { key: "game-a", lockAt: 1_500 },
      { key: "game-b", lockAt: 2_500 },
    ],
    ...overrides,
  };
}

describe("selectPublicPredictionStatus", () => {
  it("returns every actionable round in next-lock order", () => {
    const result = selectPublicPredictionStatus(
      [
        week({ id: 2, week_key: "later", close_at: 4_000 }),
        week({ id: 1, week_key: "urgent", close_at: 3_000 }),
      ],
      NOW,
    );

    expect(result.state).toBe("open");
    expect(result.rounds.map((round) => round.weekKey)).toEqual(["urgent", "later"]);
    expect(result.round).toMatchObject({
      weekKey: "urgent",
      status: "partly open",
      openGames: 1,
      lockedGames: 1,
      totalGames: 2,
      nextLockAt: 2_500,
    });
  });

  it("returns the next scheduled round when none is open", () => {
    const result = selectPublicPredictionStatus(
      [
        week({ id: 2, week_key: "later", open_at: 5_000, close_at: 7_000 }),
        week({ id: 1, week_key: "next", open_at: 4_000, close_at: 6_000 }),
      ],
      NOW,
    );

    expect(result.state).toBe("upcoming");
    expect(result.round?.weekKey).toBe("next");
  });

  it("identifies an unscored locked round", () => {
    const result = selectPublicPredictionStatus(
      [week({ games: [{ key: "game-a", lockAt: 1_000 }], close_at: 1_500 })],
      NOW,
    );

    expect(result.state).toBe("awaiting-scoring");
    expect(result.round).toMatchObject({ status: "locked", openGames: 0 });
  });

  it("returns idle after rounds are scored", () => {
    const result = selectPublicPredictionStatus([week({ status: "scored" })], NOW);
    expect(result).toEqual({ state: "idle", round: null, rounds: [], upcomingRounds: [], awaitingRounds: [] });
  });
});
