"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ANALYTICS_CONSENT_CHANGED_EVENT,
  ANALYTICS_CONSENT_KEY,
  parseGoogleAnalyticsConsent,
  type GoogleAnalyticsConsent,
} from "@/lib/google-analytics";
import {
  PRODUCT_ANALYTICS_EVENT,
  productEventDispatchFromEvent,
  type ProductEventName,
} from "@/lib/product-analytics";

const VISITOR_KEY = "ec_analytics_visitor";
const SESSION_KEY = "ec_analytics_session";
const SESSION_EXPIRES_KEY = "ec_analytics_session_expires";
const ACQUISITION_KEY = "ec_analytics_acquisition";
const SESSION_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,80}$/;
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
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

export const ACQUISITION_SOURCES = ["direct", "x", "discord", "google", "bing", "other_referral"] as const;

export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

type Acquisition = {
  source: AcquisitionSource;
  campaign?: string;
};

type AnalyticsPayload = {
  visitorId: string;
  sessionId: string;
  eventType: "pageview" | "engagement" | "product";
  path: string;
  acquisitionSource: AcquisitionSource;
  campaign?: string;
  durationSeconds?: number;
  eventName?: ProductEventName;
};

const MAX_SEEN_PRODUCT_EVENT_TOKENS = 128;

export function markProductEventTokenSeen(
  seen: Set<symbol>,
  order: symbol[],
  token: symbol,
  maxTokens = MAX_SEEN_PRODUCT_EVENT_TOKENS,
) {
  if (seen.has(token)) return false;
  seen.add(token);
  order.push(token);
  if (order.length > maxTokens) {
    const oldest = order.shift();
    if (oldest) seen.delete(oldest);
  }
  return true;
}

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

function isAcquisitionSource(value: unknown): value is AcquisitionSource {
  return typeof value === "string" && (ACQUISITION_SOURCES as readonly string[]).includes(value);
}

function cleanCampaign(value: string | null | undefined) {
  const campaign = value?.trim().toLowerCase() || "";
  return CAMPAIGN_RE.test(campaign) ? campaign : undefined;
}

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function sourceFromHint(value: string | null): AcquisitionSource | null {
  const hint = value?.trim().toLowerCase();
  if (!hint) return null;
  if (["x", "twitter", "t.co"].includes(hint)) return "x";
  if (["discord", "discord.com", "discord.gg"].includes(hint)) return "discord";
  if (hint === "google") return "google";
  if (hint === "bing") return "bing";
  if (hint === "direct") return "direct";
  return "other_referral";
}

function sourceFromReferrer(referrer: string, currentOrigin: string): AcquisitionSource {
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (url.origin === currentOrigin) return "direct";
    const hostname = url.hostname.toLowerCase();
    if (["x.com", "twitter.com", "t.co"].some((domain) => hostnameMatches(hostname, domain))) return "x";
    if (["discord.com", "discord.gg", "discordapp.com"].some((domain) => hostnameMatches(hostname, domain))) {
      return "discord";
    }
    if (
      hostnameMatches(hostname, "google.com") ||
      /^(?:[^.]+\.)*google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(hostname)
    ) {
      return "google";
    }
    if (hostnameMatches(hostname, "bing.com")) return "bing";
    return "other_referral";
  } catch {
    return "direct";
  }
}

export function deriveAcquisition(currentUrl: string, referrer = ""): Acquisition {
  try {
    const url = new URL(currentUrl);
    const source = sourceFromHint(url.searchParams.get("utm_source")) ?? sourceFromReferrer(referrer, url.origin);
    const campaign = cleanCampaign(url.searchParams.get("utm_campaign"));
    return campaign ? { source, campaign } : { source };
  } catch {
    return { source: "direct" };
  }
}

function storedAcquisition(storage: Storage) {
  const value = storageGet(storage, ACQUISITION_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!isAcquisitionSource(parsed.source)) return null;
    const campaign = typeof parsed.campaign === "string" ? cleanCampaign(parsed.campaign) : undefined;
    return campaign ? { source: parsed.source, campaign } : { source: parsed.source };
  } catch {
    return null;
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
    return { id: existing, isNew: false };
  }
  const id = randomId();
  storageSet(window.sessionStorage, SESSION_KEY, id);
  storageSet(window.sessionStorage, SESSION_EXPIRES_KEY, String(now + SESSION_TTL_MS));
  return { id, isNew: true };
}

function hasGlobalPrivacyControl() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true;
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
  const [analyticsConsent, setAnalyticsConsent] = useState<GoogleAnalyticsConsent | null | undefined>(undefined);
  const visitorRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const acquisitionRef = useRef<Acquisition | null>(null);
  const pathRef = useRef<string | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const pendingSecondsRef = useRef(0);
  const seenProductEventTokensRef = useRef(new Set<symbol>());
  const productEventTokenOrderRef = useRef<symbol[]>([]);

  useEffect(() => {
    const onConsentChanged = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setAnalyticsConsent(parseGoogleAnalyticsConsent(typeof detail === "string" ? detail : null));
    };
    window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onConsentChanged);
    const initialize = window.setTimeout(() => {
      setAnalyticsConsent(parseGoogleAnalyticsConsent(storageGet(window.localStorage, ANALYTICS_CONSENT_KEY)));
    }, 0);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onConsentChanged);
    };
  }, []);

  useEffect(() => {
    if (analyticsConsent !== "granted" || !pathname || !isTrackablePath(pathname) || hasGlobalPrivacyControl()) return;

    visitorRef.current = visitorId();
    const session = sessionId();
    if (session.id !== sessionRef.current || !acquisitionRef.current) {
      const acquisition = session.isNew ? null : storedAcquisition(window.sessionStorage);
      acquisitionRef.current = acquisition ?? deriveAcquisition(window.location.href, document.referrer);
      storageSet(window.sessionStorage, ACQUISITION_KEY, JSON.stringify(acquisitionRef.current));
    }
    sessionRef.current = session.id;
    const seenProductEventTokens = seenProductEventTokensRef.current;
    const productEventTokenOrder = productEventTokenOrderRef.current;

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
      if (!visitorRef.current || !sessionRef.current || !acquisitionRef.current || !pathRef.current || durationSeconds <= 0) {
        return;
      }
      pendingSecondsRef.current = 0;
      sendAnalyticsEvent(
        {
          visitorId: visitorRef.current,
          sessionId: sessionRef.current,
          eventType: "engagement",
          path: pathRef.current,
          acquisitionSource: acquisitionRef.current.source,
          campaign: acquisitionRef.current.campaign,
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
      acquisitionSource: acquisitionRef.current.source,
      campaign: acquisitionRef.current.campaign,
    });

    const onProductEvent = (event: Event) => {
      const productEvent = productEventDispatchFromEvent(event);
      if (!productEvent || !visitorRef.current || !sessionRef.current || !acquisitionRef.current || !pathRef.current) {
        return;
      }

      if (!markProductEventTokenSeen(
        seenProductEventTokens,
        productEventTokenOrder,
        productEvent.token,
      )) return;

      sendAnalyticsEvent({
        visitorId: visitorRef.current,
        sessionId: sessionRef.current,
        eventType: "product",
        eventName: productEvent.name,
        path: pathRef.current,
        acquisitionSource: acquisitionRef.current.source,
        campaign: acquisitionRef.current.campaign,
      });
    };

    const interval = window.setInterval(() => flush(false), HEARTBEAT_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(true);
      else activeStartedAtRef.current = Date.now();
    };
    const onPageHide = () => flush(true);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener(PRODUCT_ANALYTICS_EVENT, onProductEvent);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener(PRODUCT_ANALYTICS_EVENT, onProductEvent);
      seenProductEventTokens.clear();
      productEventTokenOrder.length = 0;
      if (parseGoogleAnalyticsConsent(storageGet(window.localStorage, ANALYTICS_CONSENT_KEY)) === "granted") {
        flush(true);
      }
    };
  }, [analyticsConsent, pathname]);

  return null;
}
