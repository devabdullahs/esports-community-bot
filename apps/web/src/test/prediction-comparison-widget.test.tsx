import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PredictionComparisonWidget } from "@/components/dashboard/prediction-comparison-widget";

const ranked = {
  overall: { rank: 1, total: 5, percentile: 80 },
  latestWeek: { weekKey: "week-4", label: "Week 4", rank: 3, total: 5, percentile: 40 },
};

describe("PredictionComparisonWidget", () => {
  test("renders ranked comparison copy in English and Arabic", () => {
    const english = renderToStaticMarkup(<PredictionComparisonWidget comparison={ranked} locale="en" />);
    const arabic = renderToStaticMarkup(<PredictionComparisonWidget comparison={ranked} locale="ar" />);

    expect(english).toContain("Ahead of 80% of predictors.");
    expect(english).toContain("Week 4: ahead of 40% of predictors.");
    expect(arabic).toContain("متقدم على ٨٠%");
    expect(arabic).toContain("مركزك #٣ من ٥.");
  });

  test("renders unranked copy in English and Arabic", () => {
    const comparison = {
      overall: { rank: null, total: 0, percentile: null },
      latestWeek: { weekKey: "week-4", label: "Week 4", rank: null, total: 5, percentile: null },
    };
    const english = renderToStaticMarkup(<PredictionComparisonWidget comparison={comparison} locale="en" />);
    const arabic = renderToStaticMarkup(<PredictionComparisonWidget comparison={comparison} locale="ar" />);

    expect(english).toContain("Your overall comparison will appear after a score is posted.");
    expect(english).toContain("You were not ranked in Week 4.");
    expect(arabic).toContain("ستظهر مقارنتك الإجمالية");
    expect(arabic).toContain("لم تُصنف في Week 4.");
  });

  test("fails closed when a comparison percentile has no rank", () => {
    const comparison = {
      overall: { rank: null, total: 5, percentile: 80 },
      latestWeek: { weekKey: "week-4", label: "Week 4", rank: null, total: 5, percentile: 40 },
    };
    const markup = renderToStaticMarkup(<PredictionComparisonWidget comparison={comparison} locale="en" />);

    expect(markup).toContain("Your overall comparison will appear after a score is posted.");
    expect(markup).toContain("You were not ranked in Week 4.");
  });
});
