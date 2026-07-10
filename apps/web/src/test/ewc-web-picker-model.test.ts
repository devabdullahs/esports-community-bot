import { describe, expect, test } from "vitest";
import { actionablePickerGames, effectiveSeasonPickerStatus, knownPickerClubs, seasonPickerSlots } from "@/lib/ewc-web-picker-model";

describe("web prediction picker model", () => {
  const rounds = [
    {
      weekKey: "week-one",
      label: "Week one",
      games: [
        { key: "open", game: "Valorant", event: "EWC", lockAt: 100, state: "open" as const, pick: "Team Falcons" },
        { key: "locked", game: "Dota 2", event: "EWC", lockAt: 10, state: "locked" as const, pick: null },
      ],
    },
    {
      weekKey: "week-two",
      label: "Week two",
      games: [{ key: "overlap", game: "Chess", event: null, lockAt: 200, state: "open" as const, pick: null }],
    },
  ];

  test("derives season availability from both configured state and deadlines", () => {
    expect(effectiveSeasonPickerStatus(null, 100)).toBeNull();
    expect(effectiveSeasonPickerStatus({ status: "open", openAt: 200, closeAt: 300 }, 100)).toBe("upcoming");
    expect(effectiveSeasonPickerStatus({ status: "open", openAt: 100, closeAt: 300 }, 200)).toBe("open");
    expect(effectiveSeasonPickerStatus({ status: "open", openAt: 100, closeAt: 200 }, 200)).toBe("locked");
    expect(effectiveSeasonPickerStatus({ status: "scored", openAt: null, closeAt: null }, 100)).toBe("scored");
  });

  test("keeps every open game from overlapping rounds and omits locked games", () => {
    expect(actionablePickerGames(rounds)).toMatchObject([
      { weekKey: "week-one", key: "open", pick: "Team Falcons" },
      { weekKey: "week-two", key: "overlap", pick: null },
    ]);
  });

  test("models top-down season slots without a skipped rank", () => {
    expect(seasonPickerSlots(["Team Falcons", "T1"], 4)).toEqual([
      { index: 0, pick: "Team Falcons", locked: false },
      { index: 1, pick: "T1", locked: false },
      { index: 2, pick: null, locked: false },
      { index: 3, pick: null, locked: true },
    ]);
  });

  test("combines eligible choices with private saved club names", () => {
    const withChoices = [{
      ...rounds[0],
      games: rounds[0].games.map((game) => ({ ...game, choices: game.key === "open" ? ["G2 Esports"] : [] })),
    }];
    expect(knownPickerClubs(withChoices, ["T1", "Team Falcons"], ["Team Liquid"])).toEqual([
      "G2 Esports",
      "T1",
      "Team Falcons",
      "Team Liquid",
    ]);
  });
});
