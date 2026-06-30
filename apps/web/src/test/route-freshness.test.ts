import { describe, expect, it } from "vitest";

import {
  canRefreshRoute,
  pruneVisitedRoutes,
  shouldRefreshAfterHidden,
  shouldRefreshOnRouteEnter,
} from "@/lib/route-freshness";

describe("route freshness helpers", () => {
  it("does not refresh on the initial route or same-route updates", () => {
    expect(
      shouldRefreshOnRouteEnter({
        lastVisitedAt: undefined,
        now: 10_000,
        previousRouteKey: null,
        revisitAfterMs: 10_000,
        routeKey: "/games?",
      }),
    ).toBe(false);

    expect(
      shouldRefreshOnRouteEnter({
        lastVisitedAt: 1_000,
        now: 20_000,
        previousRouteKey: "/games?",
        revisitAfterMs: 10_000,
        routeKey: "/games?",
      }),
    ).toBe(false);
  });

  it("only refreshes revisited routes after the configured freshness window", () => {
    expect(
      shouldRefreshOnRouteEnter({
        lastVisitedAt: undefined,
        now: 10_000,
        previousRouteKey: "/games?",
        revisitAfterMs: 10_000,
        routeKey: "/news?",
      }),
    ).toBe(false);

    expect(
      shouldRefreshOnRouteEnter({
        lastVisitedAt: 2_000,
        now: 11_999,
        previousRouteKey: "/news?",
        revisitAfterMs: 10_000,
        routeKey: "/games?",
      }),
    ).toBe(false);

    expect(
      shouldRefreshOnRouteEnter({
        lastVisitedAt: 2_000,
        now: 12_000,
        previousRouteKey: "/news?",
        revisitAfterMs: 10_000,
        routeKey: "/games?",
      }),
    ).toBe(true);
  });

  it("forces refreshes for browser history navigation", () => {
    expect(
      shouldRefreshOnRouteEnter({
        historyNavigation: true,
        lastVisitedAt: undefined,
        now: 10_000,
        previousRouteKey: "/news?",
        revisitAfterMs: 10_000,
        routeKey: "/games?",
      }),
    ).toBe(true);
  });

  it("refreshes when a tab returns after a long hidden pause", () => {
    expect(shouldRefreshAfterHidden({ hiddenAt: null, now: 40_000, refreshAfterMs: 30_000 })).toBe(false);
    expect(shouldRefreshAfterHidden({ hiddenAt: 10_001, now: 40_000, refreshAfterMs: 30_000 })).toBe(false);
    expect(shouldRefreshAfterHidden({ hiddenAt: 10_000, now: 40_000, refreshAfterMs: 30_000 })).toBe(true);
  });

  it("throttles route refreshes unless forced", () => {
    expect(canRefreshRoute({ lastRefreshAt: 9_500, minGapMs: 1_000, now: 10_000 })).toBe(false);
    expect(canRefreshRoute({ lastRefreshAt: 9_000, minGapMs: 1_000, now: 10_000 })).toBe(true);
    expect(canRefreshRoute({ force: true, lastRefreshAt: 9_999, minGapMs: 1_000, now: 10_000 })).toBe(true);
  });

  it("prunes the oldest remembered routes first", () => {
    const routes = new Map([
      ["/one?", 1],
      ["/two?", 2],
      ["/three?", 3],
    ]);

    pruneVisitedRoutes(routes, 2);

    expect([...routes.keys()]).toEqual(["/two?", "/three?"]);
  });
});
