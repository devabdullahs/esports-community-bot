import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EwcClubHistoryChart } from "@/components/clubs/ewc-club-history-chart";
import { EwcClubStandingsTable } from "@/components/clubs/ewc-club-standings-table";
import {
  cleanEwcClubHistorySelection,
  projectEwcClubHistory,
  type EwcClubHistorySnapshot,
} from "@/lib/ewc-club-history";

function snapshot(
  fetchedAt: string,
  standings: Array<{ team: string; points: number; rank: number }>,
): EwcClubHistorySnapshot {
  return { fetchedAt, standings };
}

describe("EWC Club Championship history", () => {
  test("orders snapshots chronologically and keeps a selected club beside the leaders", () => {
    const history = projectEwcClubHistory([
      snapshot("2026-07-03T12:00:00.000Z", [
        { team: "Team Falcons", points: 70, rank: 1 },
        { team: "Team Liquid", points: 65, rank: 2 },
      ]),
      snapshot("2026-07-01T12:00:00.000Z", [
        { team: "Team Falcons", points: 10, rank: 3 },
        { team: "Team Liquid", points: 20, rank: 1 },
      ]),
      snapshot("2026-07-02T12:00:00.000Z", [
        { team: "Falcons", points: 25, rank: 2 },
        { team: "Team Liquid", points: 33, rank: 1 },
      ]),
    ], { selectedClub: "Team Liquid", topClubs: 1 });

    expect(history.series.map((series) => series.key)).toEqual(["falcons", "liquid"]);
    expect(history.series[0].points.map((point) => point.points)).toEqual([10, 25, 70]);
    expect(history.series[0].points.map((point) => point.delta)).toEqual([null, 15, 45]);
    expect(history.selectedClub).toBe("Team Liquid");
    expect(history.movers[0]).toMatchObject({ name: "Team Falcons", delta: 45, rankDelta: 1 });
  });

  test("dedupes repeated snapshot timestamps and bounds the newest history", () => {
    const history = projectEwcClubHistory([
      snapshot("2026-07-01T12:00:00.000Z", [{ team: "Team Falcons", points: 10, rank: 3 }]),
      snapshot("2026-07-02T12:00:00.000Z", [{ team: "Team Falcons", points: 20, rank: 2 }]),
      snapshot("2026-07-02T12:00:00.000Z", [{ team: "Falcons", points: 30, rank: 2 }]),
      snapshot("2026-07-03T12:00:00.000Z", [{ team: "Team Falcons", points: 50, rank: 1 }]),
    ], { maxSnapshots: 2 });

    expect(history.snapshotCount).toBe(2);
    expect(history.series).toHaveLength(1);
    expect(history.series[0].key).toBe("falcons");
    expect(history.series[0].points.map((point) => point.points)).toEqual([30, 50]);
  });

  test("keeps tie ordering stable and handles empty stored history", () => {
    const tied = projectEwcClubHistory([
      snapshot("2026-07-01T12:00:00.000Z", [
        { team: "Beta", points: 100, rank: 2 },
        { team: "Alpha", points: 100, rank: 2 },
      ]),
    ], { topClubs: 2 });

    expect(tied.series.map((series) => series.name)).toEqual(["Alpha", "Beta"]);
    expect(projectEwcClubHistory([], { selectedClub: "Team Falcons" })).toEqual({
      snapshotCount: 0,
      selectedClub: null,
      series: [],
      movers: [],
    });
    expect(cleanEwcClubHistorySelection(["  Team Falcons  ", "ignored"])).toBe("Team Falcons");
  });

  test("renders shareable club selection links from the standings table", () => {
    const html = renderToStaticMarkup(
      <EwcClubStandingsTable
        locale="en"
        selectedClub="Falcons"
        clubHref={() => "/clubs/standings?club=Team+Falcons"}
        rows={[{
          rank: 1,
          name: "Team Falcons",
          logo: null,
          points: 100,
          eligibility: "champion",
          qualifiedGameCount: 4,
          wins: 1,
          region: "gulf",
          locationLabel: null,
        }]}
      />,
    );

    expect(html).toContain('href="/clubs/standings?club=Team+Falcons"');
    expect(html).toContain('aria-current="true"');
  });

  test("renders supplied series, an accessible table fallback, and the empty state", () => {
    const history = projectEwcClubHistory([
      snapshot("2026-07-01T12:00:00.000Z", [{ team: "Team Falcons", points: 10, rank: 2 }]),
      snapshot("2026-07-02T12:00:00.000Z", [{ team: "Falcons", points: 30, rank: 1 }]),
    ]);
    const html = renderToStaticMarkup(<EwcClubHistoryChart history={history} locale="en" />);
    const empty = renderToStaticMarkup(
      <EwcClubHistoryChart history={projectEwcClubHistory([])} locale="ar" />,
    );

    expect(html).toContain('data-history-series-count="1"');
    expect(html).toContain("View history as a table");
    expect(html).toContain("Falcons");
    expect(empty).toContain('dir="rtl"');
    expect(empty).toContain("\u0644\u0627 \u064a\u0648\u062c\u062f \u0633\u062c\u0644 \u062a\u0631\u062a\u064a\u0628 \u0645\u062d\u0641\u0648\u0638 \u0628\u0639\u062f");
  });
});
