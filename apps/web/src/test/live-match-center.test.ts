import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/tournaments", () => ({
  listTournamentSummariesCached: vi.fn(),
  getTournamentMatchesCached: vi.fn(),
  matchHasDetails: (value: unknown) => value === true || value === 1 || value === "1",
}));

import { GET } from "@/app/api/live/route";
import {
  buildLiveMatchCenter,
  getLiveMatchCenter,
  LIVE_RECENT_FINISHED_LIMIT,
  LIVE_UPCOMING_LIMIT,
} from "@/lib/live-match-center";
import {
  getTournamentMatchesCached,
  listTournamentSummariesCached,
  type MatchRow,
  type TournamentMatches,
} from "@/lib/tournaments";

function match(overrides: Partial<MatchRow> & Pick<MatchRow, "id" | "status">): MatchRow {
  return {
    id: overrides.id,
    name: null,
    team_a: "Team A",
    team_b: "Team B",
    logo_a: null,
    logo_b: null,
    score_a: null,
    score_b: null,
    status: overrides.status,
    scheduled_at: 1_800_000_000,
    updated_at: "2026-07-17 10:00:00",
    ...overrides,
  };
}

function tournament(
  id: number,
  game: string | null,
  matches: Partial<TournamentMatches["matches"]> = {},
): TournamentMatches {
  const running = matches.running ?? [];
  const scheduled = matches.scheduled ?? [];
  const finished = matches.finished ?? [];
  return {
    tournament: {
      id,
      name: `Tournament ${id}`,
      game,
      source: "liquipedia",
      url: "https://liquipedia.net/example",
      ewc: false,
      completed: false,
      final_standings_section: null,
      syncHealth: { state: "fresh", lastSuccessAt: 1_800_000_000, source: "liquipedia" },
    },
    matches: { running, scheduled, finished },
    standings: [],
    total: running.length + scheduled.length + finished.length,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("live match center projection", () => {
  test("orders running matches by game then scheduled time and upcoming matches by nearest time", () => {
    const center = buildLiveMatchCenter([
      tournament(1, "valorant", {
        running: [match({ id: 11, status: "running", scheduled_at: 300 })],
        scheduled: [match({ id: 12, status: "scheduled", scheduled_at: 400 })],
      }),
      tournament(2, "counterstrike", {
        running: [
          match({ id: 21, status: "running", scheduled_at: 300 }),
          match({ id: 22, status: "running", scheduled_at: 100 }),
        ],
        scheduled: [match({ id: 23, status: "scheduled", scheduled_at: 200 })],
      }),
    ]);

    expect(center.running.map((item) => item.id)).toEqual([22, 21, 11]);
    expect(center.upcoming.map((item) => item.id)).toEqual([23, 12]);
  });

  test("caps upcoming and recent finished rows while retaining the nearest and newest matches", () => {
    const center = buildLiveMatchCenter([
      tournament(1, "valorant", {
        scheduled: Array.from({ length: LIVE_UPCOMING_LIMIT + 3 }, (_, index) =>
          match({ id: index + 1, status: "scheduled", scheduled_at: 1_000 + index }),
        ),
        finished: Array.from({ length: LIVE_RECENT_FINISHED_LIMIT + 3 }, (_, index) =>
          match({ id: 100 + index, status: "finished", scheduled_at: 2_000 + index }),
        ),
      }),
    ]);

    expect(center.upcoming).toHaveLength(LIVE_UPCOMING_LIMIT);
    expect(center.upcoming.at(-1)?.id).toBe(LIVE_UPCOMING_LIMIT);
    expect(center.recentFinished).toHaveLength(LIVE_RECENT_FINISHED_LIMIT);
    expect(center.recentFinished[0]?.id).toBe(100 + LIVE_RECENT_FINISHED_LIMIT + 2);
  });

  test("returns empty lists when there are no active match rows", () => {
    expect(buildLiveMatchCenter([null, tournament(1, "valorant")])).toEqual({
      running: [],
      upcoming: [],
      recentFinished: [],
    });
  });

  test("adds match-detail URLs and omits raw database/provider fields", () => {
    const center = buildLiveMatchCenter([
      tournament(7, "valorant", {
        running: [match({
          id: 70,
          status: "running",
          has_details: true,
          external_id: "Match:private-provider-key",
          stream_platform: "twitch",
          stream_url: "https://private.example/stream",
          coStreams: [{ platform: "twitch", handle: "caster", label: "Caster", url: "https://twitch.tv/caster" }],
        })],
      }),
    ]);

    expect(center.running[0]).toMatchObject({
      detailsHref: "/matches/70",
      tournamentHref: "/tournaments/7",
      coStreams: [{ platform: "twitch", handle: "caster" }],
    });
    expect(JSON.stringify(center)).not.toMatch(/external_id|stream_platform|stream_url|guild_id|updated_at/i);
  });
});

describe("GET /api/live", () => {
  test("returns the cached public projection without provider-facing fields", async () => {
    vi.mocked(listTournamentSummariesCached).mockResolvedValue([{ id: 5 }] as never);
    vi.mocked(getTournamentMatchesCached).mockResolvedValue(tournament(5, "valorant", {
      running: [match({ id: 50, status: "running", has_details: true, external_id: "raw" })],
    }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=30");
    expect(body).toEqual({
      running: [expect.objectContaining({ id: 50, detailsHref: "/matches/50" })],
      upcoming: [],
      recentFinished: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/external_id|stream_platform|stream_url|guild_id|updated_at/i);
    expect(getTournamentMatchesCached).toHaveBeenCalledWith(5, { limit: LIVE_RECENT_FINISHED_LIMIT });
    await expect(getLiveMatchCenter()).resolves.toEqual(body);
  });
});
