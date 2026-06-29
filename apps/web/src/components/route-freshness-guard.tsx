"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

const MIN_ROUTE_REFRESH_GAP_MS = 250;
const FOCUS_REFRESH_AFTER_MS = 30_000;

export function RouteFreshnessGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname ?? ""}?${searchParams?.toString() ?? ""}`;
  const lastRouteKeyRef = useRef<string | null>(null);
  const lastRefreshAtRef = useRef(0);
  const lastHiddenAtRef = useRef<number | null>(null);

  const refreshRoute = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && now - lastRefreshAtRef.current < MIN_ROUTE_REFRESH_GAP_MS) return;
      lastRefreshAtRef.current = now;
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (lastRouteKeyRef.current === null) {
      lastRouteKeyRef.current = routeKey;
      return;
    }

    if (lastRouteKeyRef.current !== routeKey) {
      lastRouteKeyRef.current = routeKey;
      const timer = window.setTimeout(() => refreshRoute(), 0);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [refreshRoute, routeKey]);

  useEffect(() => {
    const refreshAfterLongPause = () => {
      const hiddenAt = lastHiddenAtRef.current;
      lastHiddenAtRef.current = null;
      if (hiddenAt && Date.now() - hiddenAt >= FOCUS_REFRESH_AFTER_MS) refreshRoute();
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshRoute(true);
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
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshRoute]);

  return null;
}
