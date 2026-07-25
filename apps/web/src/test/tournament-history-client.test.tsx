import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  fetchTournamentMatchesPage,
  mergeBracketMatchSnapshot,
  shouldPollTournamentMatches,
  tournamentMatchesQueryKey,
  TournamentRefreshFailureAlert,
  type TournamentMatchesPayload,
} from "@/components/tournaments/tournament-match-list";

function match(id: number, status: "running" | "scheduled" | "finished") {
  return {
    id,
    name: `Match ${id}`,
    team_a: `A${id}`,
    team_b: `B${id}`,
    logo_a: null,
    logo_b: null,
    score_a: status === "finished" ? 2 : null,
    score_b: status === "finished" ? 1 : null,
    status,
    scheduled_at: 1_800_000_000 + id,
    updated_at: null,
  };
}

function payload({
  offset = 0,
  finishedTotal = 2,
  completed = false,
  health = "fresh",
}: {
  offset?: number;
  finishedTotal?: number;
  completed?: boolean;
  health?: TournamentMatchesPayload["tournament"]["syncHealth"]["state"];
} = {}): TournamentMatchesPayload {
  const finished = [match(10 + offset, "finished"), match(11 + offset, "finished")];
  return {
    tournament: {
      id: 99,
      name: "Fixture event",
      game: "valorant",
      source: "liquipedia",
      url: null,
      ewc: false,
      completed,
      final_standings_section: null,
      syncHealth: { state: health, lastSuccessAt: 1_700_000_000, source: "liquipedia" },
    },
    matches: {
      running: completed ? [] : [match(1, "running")],
      scheduled: [],
      finished,
      postponed: [],
      cancelled: [],
    },
    bracketMatches: [match(1, "running"), ...finished],
    standings: [],
    totals: {
      running: completed ? 0 : 1,
      scheduled: 0,
      finished: finishedTotal,
      postponed: 0,
      cancelled: 0,
      all: finishedTotal + (completed ? 0 : 1),
    },
    finishedPage: { offset, limit: 2, hasMore: offset + 2 < finishedTotal },
    total: finishedTotal + (completed ? 0 : 1),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tournament history client behavior", () => {
  test("polls mutable snapshots but stops final and completed snapshots", () => {
    expect(shouldPollTournamentMatches(payload())).toBe(true);
    expect(shouldPollTournamentMatches(payload({ health: "final" }))).toBe(false);
    expect(shouldPollTournamentMatches(payload({ completed: true }))).toBe(false);
  });

  test("preserves a complete bracket snapshot while overlaying refreshed matches", () => {
    const initial = Array.from({ length: 85 }, (_, index) => match(index + 1, "finished"));
    const refreshed = [
      { ...match(1, "finished"), score_a: 3 },
      match(86, "scheduled"),
    ];
    const merged = mergeBracketMatchSnapshot(initial, refreshed);

    expect(merged).toHaveLength(86);
    expect(merged[0].score_a).toBe(3);
    expect(merged.at(-1)?.id).toBe(86);
  });

  test("retains a selected older result page when a new result changes boundaries", async () => {
    const initial = payload({ offset: 50, finishedTotal: 85 });
    const refreshed = payload({ offset: 50, finishedTotal: 86 });
    refreshed.matches.running = [match(2, "running")];
    refreshed.matches.finished = [match(60, "finished"), match(61, "finished")];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(refreshed)));

    const result = await fetchTournamentMatchesPage(99, initial);

    expect(result.matches.running[0].id).toBe(2);
    expect(result.matches.finished).toEqual(initial.matches.finished);
    expect(result.finishedPage).toEqual(initial.finishedPage);
    expect(result.totals.finished).toBe(86);
  });

  test("keeps cached rows after a failed refresh and succeeds on retry", async () => {
    const initial = payload();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = tournamentMatchesQueryKey(99, initial);
    queryClient.setQueryData(queryKey, initial);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ ...initial, matches: { ...initial.matches, running: [match(2, "running")] } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(queryClient.fetchQuery({
      queryKey,
      queryFn: () => fetchTournamentMatchesPage(99, initial),
    })).rejects.toThrow("offline");
    expect(queryClient.getQueryData(queryKey)).toEqual(initial);

    const retried = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => fetchTournamentMatchesPage(99, initial),
    });
    expect(retried.matches.running[0].id).toBe(2);
  });

  test("renders retained-data failure and retry copy in English and Arabic", () => {
    const lastSuccess = "2026-07-24T10:00:00.000Z";
    const english = renderToStaticMarkup(
      <TournamentRefreshFailureAlert
        locale="en"
        lastSuccessfulRefresh={lastSuccess}
        onRetry={() => undefined}
      />,
    );
    const arabic = renderToStaticMarkup(
      <div dir="rtl">
        <TournamentRefreshFailureAlert
          locale="ar"
          lastSuccessfulRefresh={lastSuccess}
          onRetry={() => undefined}
        />
      </div>,
    );

    expect(english).toContain("Tournament refresh failed");
    expect(english).toContain("Retry");
    expect(english).toContain('dateTime="2026-07-24T10:00:00.000Z"');
    expect(arabic).toContain('dir="rtl"');
    expect(arabic).toContain("\u062a\u0639\u0630\u0631 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0628\u0637\u0648\u0644\u0629");
  });
});
