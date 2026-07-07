import { describe, expect, test } from "vitest";
import { countUniqueQualifiedGames, type EwcClubGame } from "@/lib/ewc-clubs";

function qualifiedGame(label: string, pageUrl: string | null = null): EwcClubGame {
  return {
    label,
    shortLabel: label,
    pageUrl,
    icon: null,
    status: "qualified",
    entries: [],
  };
}

describe("EWC club tracker helpers", () => {
  test("counts unique qualified games, not club-game slots", () => {
    const dota = qualifiedGame("Dota 2", "https://liquipedia.net/dota2/Esports_World_Cup/2026");

    expect(
      countUniqueQualifiedGames([
        { qualifiedGames: [dota] },
        { qualifiedGames: [dota, qualifiedGame("Chess", "https://liquipedia.net/chess/Esports_World_Cup/2026")] },
      ]),
    ).toBe(2);
  });

  test("dedupes by normalized label when a game page URL is missing", () => {
    expect(
      countUniqueQualifiedGames([
        { qualifiedGames: [qualifiedGame("Counter-Strike 2")] },
        { qualifiedGames: [qualifiedGame("counter strike 2")] },
      ]),
    ).toBe(1);
  });
});
