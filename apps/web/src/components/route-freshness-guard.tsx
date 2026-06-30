"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import {
  canRefreshRoute,
  pruneVisitedRoutes,
  ROUTE_FRESHNESS_LIMITS,
  shouldRefreshAfterHidden,
  shouldRefreshOnRouteEnter,
} from "@/lib/route-freshness";

const ROUTE_REFRESH_DELAY_MS = 75;

export function RouteFreshnessGuard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname ?? ""}?${searchParams?.toString() ?? ""}`;
  const lastRouteKeyRef = useRef<string | null>(null);
  const visitedRouteAtRef = useRef(new Map<string, number>());
  const lastRefreshAtRef = useRef(0);
  const lastHiddenAtRef = useRef<number | null>(null);
  const pendingHistoryNavigationRef = useRef(false);

  const refreshRoute = useCallback(
    (force = false) => {
      const now = Date.now();
      if (
        !canRefreshRoute({
          force,
          lastRefreshAt: lastRefreshAtRef.current,
          minGapMs: ROUTE_FRESHNESS_LIMITS.minRefreshGapMs,
          now,
        })
      ) {
        return;
      }
      lastRefreshAtRef.current = now;
      void queryClient.invalidateQueries({ refetchType: "active" });
      router.refresh();
    },
    [queryClient, router],
  );

  useEffect(() => {
    const now = Date.now();
    const previousRoute = lastRouteKeyRef.current;
    const lastVisitedAt = visitedRouteAtRef.current.get(routeKey);
    const historyNavigation = pendingHistoryNavigationRef.current;
    pendingHistoryNavigationRef.current = false;
    visitedRouteAtRef.current.set(routeKey, now);
    pruneVisitedRoutes(visitedRouteAtRef.current, ROUTE_FRESHNESS_LIMITS.maxTrackedRoutes);

    if (lastRouteKeyRef.current === null) {
      lastRouteKeyRef.current = routeKey;
      return;
    }

    if (previousRoute !== routeKey) {
      lastRouteKeyRef.current = routeKey;
      const shouldRefresh = shouldRefreshOnRouteEnter({
        historyNavigation,
        lastVisitedAt,
        now,
        previousRouteKey: previousRoute,
        revisitAfterMs: ROUTE_FRESHNESS_LIMITS.routeRevisitRefreshAfterMs,
        routeKey,
      });
      if (!shouldRefresh) return undefined;
      const timer = window.setTimeout(() => refreshRoute(true), ROUTE_REFRESH_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [refreshRoute, routeKey]);

  useEffect(() => {
    const refreshAfterLongPause = () => {
      const hiddenAt = lastHiddenAtRef.current;
      lastHiddenAtRef.current = null;
      if (
        shouldRefreshAfterHidden({
          hiddenAt,
          now: Date.now(),
          refreshAfterMs: ROUTE_FRESHNESS_LIMITS.focusRefreshAfterMs,
        })
      ) {
        refreshRoute(true);
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.setTimeout(() => refreshRoute(true), ROUTE_REFRESH_DELAY_MS);
    };
    const onPopState = () => {
      pendingHistoryNavigationRef.current = true;
    };

    const onFocus = () => refreshAfterLongPause();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAtRef.current = Date.now();
      } else {
        refreshAfterLongPause();
      }
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshRoute]);

  return null;
}
