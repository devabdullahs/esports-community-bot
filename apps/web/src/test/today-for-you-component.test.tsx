import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TodayForYouContent } from "@/components/dashboard/today-for-you";
import type { TodayForYouPayload } from "@/lib/today-for-you";

const populated: TodayForYouPayload = {
  liveMatches: [
    {
      id: 1,
      tournamentId: 5,
      tournamentName: "Cup",
      game: "valorant",
      teamA: "Team Falcons",
      teamB: "Team Liquid",
      status: "running",
      scheduledAt: 1_800_000_000,
      href: "/tournaments/5",
    },
  ],
  upcomingMatches: [
    {
      id: 2,
      tournamentId: 5,
      tournamentName: "Cup",
      game: "valorant",
      teamA: "Vitality",
      teamB: "Gen.G",
      status: "scheduled",
      scheduledAt: 1_800_003_600,
      href: "/tournaments/5",
    },
  ],
  unreadNotifications: [
    { type: "match_result", title: "Falcons won", body: "Cup", href: "/tournaments/5", createdAt: "2026-07-14 10:00:00" },
  ],
  actionableRounds: [
    { label: "Week 3", status: "open", closesAt: 1_800_010_000, nextLockAt: 1_800_005_000, openGames: 2, totalGames: 3, pickedGames: 1 },
  ],
  coStreams: {
    available: true,
    items: [{ label: "Arabic Valorant", game: "Valorant", title: "Playoffs", viewerCount: 100, startedAt: 1_800_000_000 }],
  },
  counts: { follows: 2, unreadNotifications: 1, actionableRounds: 1 },
  hrefs: {
    following: "/me?tab=following",
    notifications: "/me?tab=notifications",
    predictions: "/me?tab=predictions",
    games: "/games",
    tournaments: "/tournaments",
    coStreams: "/co-streams",
  },
};

describe("TodayForYouContent", () => {
  test("renders populated activity in English and Arabic with locale-aware links", () => {
    const english = renderToStaticMarkup(<TodayForYouContent locale="en" payload={populated} />);
    const arabic = renderToStaticMarkup(<TodayForYouContent locale="ar" payload={populated} />);

    expect(english).toContain("Today for you");
    expect(english).toContain("Team Falcons");
    expect(english).toContain("Arabic Valorant");
    expect(arabic).toContain("اليوم لأجلك");
    expect(arabic).toContain("/ar/me?tab=following");
    expect(arabic).toContain("<bdi>Team Falcons vs Team Liquid</bdi>");
  });

  test("renders onboarding, caught-up, loading, and partial-error states", () => {
    const onboarding = renderToStaticMarkup(
      <TodayForYouContent
        locale="en"
        payload={{
          ...populated,
          liveMatches: [],
          upcomingMatches: [],
          unreadNotifications: [],
          coStreams: { available: true, items: [] },
          counts: { follows: 0, unreadNotifications: 0, actionableRounds: 1 },
        }}
      />,
    );
    const caughtUp = renderToStaticMarkup(
      <TodayForYouContent
        locale="en"
        payload={{
          ...populated,
          liveMatches: [],
          upcomingMatches: [],
          unreadNotifications: [],
          actionableRounds: [],
          coStreams: { available: true, items: [] },
          counts: { follows: 1, unreadNotifications: 0, actionableRounds: 0 },
        }}
      />,
    );
    const loading = renderToStaticMarkup(<TodayForYouContent locale="en" loading />);
    const partial = renderToStaticMarkup(
      <TodayForYouContent locale="en" payload={{ ...populated, coStreams: { available: false, items: [] } }} onRetry={() => {}} />,
    );

    expect(onboarding).toContain("Follow the action you care about");
    expect(onboarding).toContain("Browse games");
    expect(caughtUp).toContain("You&#x27;re caught up");
    expect(loading).toContain('aria-busy="true"');
    expect(partial).toContain("temporarily unavailable");
    expect(partial).toContain("Try again");
  });
});
