import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { WebPredictionPicker } from "@/components/predictions/web-prediction-picker";

const now = Math.floor(Date.now() / 1000);

const picker = {
  weekly: [
    {
      weekKey: "week-live",
      label: "Week 3",
      state: "actionable" as const,
      status: "partly open",
      closeAt: now + 7_200,
      nextLockAt: now + 3_600,
      pickedGames: 1,
      totalGames: 2,
      score: null,
      games: [
        {
          key: "dota",
          game: "Dota 2",
          event: "EWC Dota",
          lockAt: now + 3_600,
          state: "open" as const,
          pick: null,
          choices: ["Tundra Esports"],
        },
        {
          key: "valorant",
          game: "Valorant",
          event: "EWC Valorant",
          lockAt: now - 600,
          state: "locked" as const,
          pick: "Team Falcons",
          choices: [],
          result: null,
        },
      ],
    },
    {
      weekKey: "week-done",
      label: "Week 2",
      state: "review" as const,
      status: "scored",
      closeAt: now - 86_400,
      nextLockAt: null,
      pickedGames: 1,
      totalGames: 1,
      score: 1000,
      games: [
        {
          key: "freefire",
          game: "Free Fire",
          event: "EWC Free Fire",
          lockAt: now - 100_000,
          state: "locked" as const,
          pick: "Gen.G",
          choices: [],
          result: { points: 1000, matchedClub: "Gen.G", place: "1st", winner: "Gen.G" },
        },
      ],
    },
  ],
  season: null,
};

function render(value: typeof picker | null) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WebPredictionPicker picker={value} locale="en" queryKey={["me-ewc"]} />
    </QueryClientProvider>,
  );
}

describe("WebPredictionPicker", () => {
  test("shows a locked pick inside its live round instead of dropping the game", () => {
    const markup = render(picker);

    expect(markup).toContain("Week 3");
    expect(markup).toContain("Locked this round");
    expect(markup).toContain("Team Falcons");
  });

  test("carries finished rounds with their picks and points", () => {
    const markup = render(picker);

    expect(markup).toContain("Finished rounds");
    expect(markup).toContain("Week 2");
    expect(markup).toContain("Gen.G");
    expect(markup).toContain("1,000 points");
  });

  test("states how a player pick scores when a game mixes players and clubs", () => {
    const solo = {
      ...picker,
      weekly: [
        {
          ...picker.weekly[0],
          games: [{ ...picker.weekly[0].games[0], individualPicks: true }],
        },
      ],
    };

    expect(render(solo)).toContain("A player pick scores as their club");
    expect(render(picker)).not.toContain("A player pick scores as their club");
  });

  test("falls back to the empty state when nothing is available", () => {
    const markup = render({ weekly: [], season: null });

    expect(markup).toContain("No prediction round is open");
  });
});
