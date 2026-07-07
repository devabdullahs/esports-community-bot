import { describe, expect, test } from "vitest";
import {
  filterTournamentDirectory,
  sourceLabel,
  tournamentDirectoryStats,
  tournamentPrimaryStatus,
  type TournamentDirectoryItem,
} from "@/lib/tournament-directory";

function tournament(
  overrides: Partial<TournamentDirectoryItem> & Pick<TournamentDirectoryItem, "id" | "name">,
): TournamentDirectoryItem {
  return {
    game: "counterstrike",
    gameTitle: "Counter-Strike",
    source: "liquipedia",
    sourceLabel: "Liquipedia",
    url: null,
    ewc: false,
    matchCounts: { running: 0, scheduled: 0, finished: 0 },
    featuredMatch: null,
    ...overrides,
  };
}

describe("tournament directory model", () => {
  test("normalizes known event source labels", () => {
    expect(sourceLabel("startgg")).toBe("start.gg");
    expect(sourceLabel("liquipedia")).toBe("Liquipedia");
    expect(sourceLabel("pandascore")).toBe("PandaScore");
  });

  test("prioritizes live, then upcoming, then result-only tournaments", () => {
    const live = tournament({
      id: 1,
      name: "Live event",
      matchCounts: { running: 1, scheduled: 0, finished: 0 },
    });
    const upcoming = tournament({
      id: 2,
      name: "Upcoming event",
      matchCounts: { running: 0, scheduled: 3, finished: 0 },
    });
    const results = tournament({
      id: 3,
      name: "Results event",
      matchCounts: { running: 0, scheduled: 0, finished: 8 },
    });

    expect(tournamentPrimaryStatus(live)).toBe("live");
    expect(tournamentPrimaryStatus(upcoming)).toBe("upcoming");
    expect(tournamentPrimaryStatus(results)).toBe("results");
    expect(filterTournamentDirectory([results, upcoming, live], {}).map((item) => item.id)).toEqual([
      1, 2, 3,
    ]);
  });

  test("orders live/upcoming tournaments by nearest featured match before match counts", () => {
    const soon = tournament({
      id: 10,
      name: "Soon event",
      matchCounts: { running: 0, scheduled: 1, finished: 0 },
      featuredMatch: {
        id: 100,
        name: null,
        team_a: "All Gamers",
        team_b: "Tidal Legends Gaming",
        logo_a: null,
        logo_b: null,
        score_a: null,
        score_b: null,
        status: "scheduled",
        scheduled_at: 1_900_000_000,
      },
    });
    const laterWithMoreMatches = tournament({
      id: 11,
      name: "Later event",
      matchCounts: { running: 0, scheduled: 10, finished: 0 },
      featuredMatch: {
        id: 101,
        name: null,
        team_a: "Titan Esports Club",
        team_b: "UnKnights",
        logo_a: null,
        logo_b: null,
        score_a: null,
        score_b: null,
        status: "scheduled",
        scheduled_at: 1_900_500_000,
      },
    });

    expect(filterTournamentDirectory([laterWithMoreMatches, soon], {}).map((item) => item.id)).toEqual([
      10,
      11,
    ]);
  });

  test("filters by canonical game/source while keeping result-only tournaments visible", () => {
    const events = [
      tournament({
        id: 1,
        name: "Evo 2026: TEKKEN 8",
        game: "fighters",
        gameTitle: "Fighter Games",
        source: "startgg",
        sourceLabel: "start.gg",
        matchCounts: { running: 0, scheduled: 0, finished: 24 },
      }),
      tournament({
        id: 2,
        name: "IEM Cologne",
        matchCounts: { running: 2, scheduled: 4, finished: 12 },
      }),
    ];

    expect(
      filterTournamentDirectory(events, { game: "fighters", source: "startgg", status: "results" }).map(
        (item) => item.id,
      ),
    ).toEqual([1]);
  });

  test("searches tournament names, games, sources, and featured teams", () => {
    const events = [
      tournament({
        id: 1,
        name: "Overwatch Champions Series",
        game: "overwatch",
        gameTitle: "Overwatch",
        matchCounts: { running: 1, scheduled: 0, finished: 0 },
        featuredMatch: {
          id: 10,
          name: null,
          team_a: "Twisted Minds",
          team_b: "Al Qadsiah",
          logo_a: null,
          logo_b: null,
          score_a: 0,
          score_b: 0,
          status: "running",
          scheduled_at: 1_800_000_000,
        },
      }),
      tournament({ id: 2, name: "Evo 2026: Street Fighter 6" }),
    ];

    expect(filterTournamentDirectory(events, { query: "qadsiah" }).map((item) => item.id)).toEqual([
      1,
    ]);
    expect(filterTournamentDirectory(events, { query: "street fighter" }).map((item) => item.id)).toEqual([
      2,
    ]);
  });

  test("summarizes active tournaments by unique game and primary status", () => {
    const stats = tournamentDirectoryStats([
      tournament({ id: 1, name: "Live", matchCounts: { running: 1, scheduled: 0, finished: 0 } }),
      tournament({
        id: 2,
        name: "Upcoming",
        game: "fighters",
        matchCounts: { running: 0, scheduled: 2, finished: 0 },
      }),
      tournament({
        id: 3,
        name: "Results",
        game: "fighters",
        matchCounts: { running: 0, scheduled: 0, finished: 3 },
      }),
    ]);

    expect(stats).toEqual({ tournaments: 3, games: 2, live: 1, upcoming: 1, results: 1 });
  });
});
