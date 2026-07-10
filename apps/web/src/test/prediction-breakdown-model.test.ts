import { describe, expect, test } from "vitest";
import { isExpandableScoreBreakdown, scoreBreakdownStatusKey } from "@/lib/prediction-breakdown-model";

describe("prediction breakdown model", () => {
  test("only expands persisted, available score detail", () => {
    expect(isExpandableScoreBreakdown(null)).toBe(false);
    expect(isExpandableScoreBreakdown({ available: false, kind: "weekly", total: 0, bonus: 0, rows: [], integrity: "unavailable" })).toBe(false);
    expect(isExpandableScoreBreakdown({ available: true, kind: "weekly-per-game", total: 1000, bonus: 0, rows: [], integrity: "ok" })).toBe(true);
  });

  test("maps only known outcome statuses for localized rendering", () => {
    expect(scoreBreakdownStatusKey("late")).toBe("late");
    expect(scoreBreakdownStatusKey("unmatched")).toBe("unmatched");
    expect(scoreBreakdownStatusKey("unexpected")).toBe("scored");
  });
});
