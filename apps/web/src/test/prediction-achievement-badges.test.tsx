import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  MAX_VISIBLE_PREDICTION_ACHIEVEMENTS,
  PredictionAchievementBadges,
  splitPredictionAchievementBadges,
} from "@/components/predictions/prediction-achievement-badges";

const ACHIEVEMENTS = [
  "weekly-winner",
  "top-ten",
  "perfect-week",
  "scoring-streak",
];

describe("PredictionAchievementBadges", () => {
  test("keeps three compact badges visible and moves remaining badges into overflow", () => {
    const result = splitPredictionAchievementBadges([...ACHIEVEMENTS, "top-ten", "unknown"]);

    expect(MAX_VISIBLE_PREDICTION_ACHIEVEMENTS).toBe(3);
    expect(result.visible.map((achievement) => achievement.id)).toEqual(ACHIEVEMENTS.slice(0, 3));
    expect(result.overflow.map((achievement) => achievement.id)).toEqual(["scoring-streak"]);
  });

  test("renders localized names and an accessible overflow trigger", () => {
    const html = renderToStaticMarkup(
      <PredictionAchievementBadges achievementIds={ACHIEVEMENTS} locale="en" showLabels />,
    );

    expect(html).toContain("Weekly winner");
    expect(html).toContain("Top 10");
    expect(html).toContain("Perfect week");
    expect(html).toContain("+1");
    expect(html).toContain('aria-label="1 more achievements"');
  });
});
