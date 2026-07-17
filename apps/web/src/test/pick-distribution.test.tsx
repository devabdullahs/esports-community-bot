import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PickDistributionPanel } from "@/components/predictions/pick-distribution";
import type { PredictionPickDistribution } from "@/lib/prediction-pick-distribution";

const lockedDistribution: PredictionPickDistribution = {
  locked: true,
  totalPicks: 2,
  games: [
    {
      gameKey: "valorant",
      game: "VALORANT",
      event: "Playoffs",
      totalPicks: 2,
      picks: [
        { pick: "Paper Rex", count: 1, percentage: 50 },
        { pick: "Sentinels", count: 1, percentage: 50 },
      ],
    },
    {
      gameKey: "free-fire",
      game: "Free Fire",
      event: "Knockout",
      totalPicks: 0,
      picks: [],
    },
  ],
};

describe("pick distribution panel", () => {
  it("does not render an unlocked distribution", () => {
    const markup = renderToStaticMarkup(
      <PickDistributionPanel locale="en" distribution={{ ...lockedDistribution, locked: false }} />,
    );

    expect(markup).toBe("");
    expect(markup).not.toContain("Paper Rex");
  });

  it("renders tied counts, percentages, and zero-pick games after lock", () => {
    const markup = renderToStaticMarkup(<PickDistributionPanel locale="en" distribution={lockedDistribution} />);

    expect(markup).toContain("Community picks");
    expect(markup).toContain("Paper Rex (1 pick)");
    expect(markup).toContain("Sentinels (1 pick)");
    expect(markup.match(/>50%<\/span>/g)).toHaveLength(2);
    expect(markup).toContain("Free Fire");
    expect(markup).toContain("No community picks yet");
  });

  it("uses RTL Arabic labels", () => {
    const markup = renderToStaticMarkup(<PickDistributionPanel locale="ar" distribution={lockedDistribution} />);

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain("اختيارات المجتمع");
    expect(markup).toContain("اختيارات");
  });
});
