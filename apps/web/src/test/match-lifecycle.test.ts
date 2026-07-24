import { describe, expect, test } from "vitest";
import {
  matchOutcomeLabel,
  matchStatusLabel,
  matchWinner,
  shouldShowOutcomeLabel,
} from "@/lib/match-lifecycle";

describe("match lifecycle presentation", () => {
  test("uses an explicit winner for a scoreless walkover", () => {
    const match = {
      status: "finished" as const,
      team_a: "Alpha",
      team_b: "Bravo",
      score_a: null,
      score_b: null,
      winner_side: "team2" as const,
      result_reason: "walkover" as const,
    };

    expect(matchWinner(match)).toBe("b");
    expect(matchOutcomeLabel(match, "en")).toBe("Bravo won by walkover");
    expect(matchOutcomeLabel(match, "ar")).toBe("فاز Bravo لعدم حضور الخصم");
    expect(shouldShowOutcomeLabel(match)).toBe(true);
  });

  test("localizes postponed and cancelled states without inferring a winner", () => {
    const postponed = {
      status: "postponed" as const,
      winner_side: null,
      result_reason: "postponed" as const,
    };
    const cancelled = {
      status: "cancelled" as const,
      winner_side: null,
      result_reason: "cancelled" as const,
    };

    expect(matchStatusLabel("postponed", "en")).toBe("Postponed");
    expect(matchStatusLabel("postponed", "ar")).toBe("مؤجلة");
    expect(matchOutcomeLabel(cancelled, "en")).toBe("Cancelled");
    expect(matchOutcomeLabel(cancelled, "ar")).toBe("ملغاة");
    expect(matchWinner(postponed)).toBeNull();
    expect(matchWinner(cancelled)).toBeNull();
    expect(shouldShowOutcomeLabel(postponed)).toBe(true);
    expect(shouldShowOutcomeLabel(cancelled)).toBe(true);
  });

  test("does not infer an outcome while a match is running", () => {
    const running = {
      status: "running" as const,
      team_a: "Alpha",
      team_b: "Bravo",
      score_a: 2,
      score_b: 0,
      winner_side: "team1" as const,
      result_reason: "normal" as const,
    };

    expect(matchWinner(running)).toBeNull();
    expect(matchOutcomeLabel(running, "en")).toBe("Live now");
    expect(shouldShowOutcomeLabel(running)).toBe(false);
  });
});
