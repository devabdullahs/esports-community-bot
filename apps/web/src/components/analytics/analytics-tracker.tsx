"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const VISITOR_KEY = "ec_analytics_visitor";
const SESSION_KEY = "ec_analytics_session";
const SESSION_EXPIRES_KEY = "ec_analytics_session_expires";
const SESSION_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,80}$/;
const STATIC_EXT_RE = /\.(?:avif|gif|ico|jpeg|jpg|js|json|map|png|svg|webmanifest|webp|xml|txt|css)$/i;
const BLOCKED_PATHS = [
  "/admin",
  "/api",
  "/login",
  "/_next",
  "/favicon",
  "/icon",
  "/apple-icon",
  "/robots.txt",
  "/sitemap.xml",
];

type AnalyticsPayload = {
  visitorId: string;
  sessionId: string;
  eventType: "pageview" | "engagement";
  path: string;
  referrer?: string;
  durationSeconds?: number;
};

function stripLocale(path: string) {
  return path.replace(/^\/(?:en|ar)(?=\/|$)/, "") || "/";
}

function isTrackablePath(path: string) {
  const normalized = stripLocale(path);
  return !STATIC_EXT_RE.test(normalized) && !BLOCKED_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function storageGet(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Private browsing or disabled storage: skip persistence for this event.
  }
}

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function visitorId() {
  const existing = storageGet(window.localStorage, VISITOR_KEY);
  if (existing && ID_RE.test(existing)) return existing;
  const id = randomId();
  storageSet(window.localStorage, VISITOR_KEY, id);
  return id;
}

function sessionId() {
  const now = Date.now();
  const existing = storageGet(window.sessionStorage, SESSION_KEY);
  const expires = Number(storageGet(window.sessionStorage, SESSION_EXPIRES_KEY) || 0);
  if (existing && ID_RE.test(existing) && expires > now) {
    storageSet(window.sessionStorage, SESSION_EXPIRES_KEY, String(now + SESSION_TTL_MS));
    return existing;
  }
  const id = randomId();
  storageSet(window.sessionStorage, SESSION_KEY, id);
  storageSet(window.sessionStorage, SESSION_EXPIRES_KEY, String(now + SESSION_TTL_MS));
  return id;
}

function respectsPrivacySignals() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function sendAnalyticsEvent(payload: AnalyticsPayload, beacon = false) {
  const body = JSON.stringify(payload);
  if (beacon && "sendBeacon" in navigator) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/analytics/event", blob);
    return;
  }

  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    // Analytics must never affect navigation.
  });
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  const visitorRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const pendingSecondsRef = useRef(0);

  useEffect(() => {
    if (!pathname || !isTrackablePath(pathname) || respectsPrivacySignals()) return;

    visitorRef.current = visitorId();
    sessionRef.current = sessionId();

    function collectVisibleSeconds() {
      if (document.visibilityState !== "visible") {
        activeStartedAtRef.current = null;
        return;
      }
      const now = Date.now();
      const startedAt = activeStartedAtRef.current ?? now;
      const delta = Math.floor((now - startedAt) / 1000);
      if (delta > 0) pendingSecondsRef.current += Math.min(delta, 120);
      activeStartedAtRef.current = now;
    }

    function flush(beacon = false) {
      collectVisibleSeconds();
      const durationSeconds = Math.floor(pendingSecondsRef.current);
      if (!visitorRef.current || !sessionRef.current || !pathRef.current || durationSeconds <= 0) return;
      pendingSecondsRef.current = 0;
      sendAnalyticsEvent(
        {
          visitorId: visitorRef.current,
          sessionId: sessionRef.current,
          eventType: "engagement",
          path: pathRef.current,
          durationSeconds,
        },
        beacon,
      );
    }

    if (pathRef.current && pathRef.current !== pathname) flush(true);
    pathRef.current = pathname;
    activeStartedAtRef.current = document.visibilityState === "visible" ? Date.now() : null;
    pendingSecondsRef.current = 0;

    sendAnalyticsEvent({
      visitorId: visitorRef.current,
      sessionId: sessionRef.current,
      eventType: "pageview",
      path: pathname,
      referrer: document.referrer || undefined,
    });

    const interval = window.setInterval(() => flush(false), HEARTBEAT_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(true);
      else activeStartedAtRef.current = Date.now();
    };
    const onPageHide = () => flush(true);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      flush(true);
    };
  }, [pathname]);

  return null;
}
