import { describe, expect, test } from "vitest";
import { actionablePickerGames, knownPickerClubs, seasonPickerSlots } from "@/lib/ewc-web-picker-model";

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

  test("reuses private known club names without adding a public lookup key", () => {
    expect(knownPickerClubs(rounds, ["T1", "Team Falcons"])).toEqual(["T1", "Team Falcons"]);
  });
});
