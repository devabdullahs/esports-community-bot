export const ROUTE_FRESHNESS_LIMITS = {
  focusRefreshAfterMs: 30_000,
  maxTrackedRoutes: 50,
  minRefreshGapMs: 1_000,
  routeRevisitRefreshAfterMs: 10_000,
} as const;

export function shouldRefreshOnRouteEnter({
  historyNavigation = false,
  lastVisitedAt,
  now,
  previousRouteKey,
  revisitAfterMs,
  routeKey,
}: {
  historyNavigation?: boolean;
  lastVisitedAt: number | null | undefined;
  now: number;
  previousRouteKey: string | null;
  revisitAfterMs: number;
  routeKey: string;
}) {
  if (!previousRouteKey || previousRouteKey === routeKey) return false;
  if (historyNavigation) return true;
  return typeof lastVisitedAt === "number" && lastVisitedAt > 0 && now - lastVisitedAt >= revisitAfterMs;
}

export function shouldRefreshAfterHidden({
  hiddenAt,
  now,
  refreshAfterMs,
}: {
  hiddenAt: number | null;
  now: number;
  refreshAfterMs: number;
}) {
  return typeof hiddenAt === "number" && now - hiddenAt >= refreshAfterMs;
}

export function canRefreshRoute({
  force = false,
  lastRefreshAt,
  minGapMs,
  now,
}: {
  force?: boolean;
  lastRefreshAt: number;
  minGapMs: number;
  now: number;
}) {
  return force || now - lastRefreshAt >= minGapMs;
}

export function pruneVisitedRoutes<T>(routes: Map<string, T>, maxRoutes: number) {
  while (routes.size > maxRoutes) {
    const oldest = routes.keys().next().value;
    if (typeof oldest !== "string") break;
    routes.delete(oldest);
  }
}
