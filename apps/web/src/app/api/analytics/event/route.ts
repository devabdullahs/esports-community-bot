import { NextResponse } from "next/server";
import {
  ensureAnalyticsSchema,
  recordAnalyticsEvent,
  recordProductAnalyticsEvent,
} from "@/lib/web-analytics";
import { clientIp } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-body";
import { isProductEventName } from "@/lib/product-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_LIMIT_BYTES = 2_048;
const ID_RE = /^[A-Za-z0-9_-]{16,80}$/;
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ACQUISITION_SOURCES = ["direct", "x", "discord", "google", "bing", "other_referral"] as const;
type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];
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
const BOT_UA_RE =
  /\b(bot|crawler|spider|preview|facebookexternalhit|discordbot|slackbot|twitterbot|whatsapp|telegrambot|googlebot|bingbot|bytespider|ahrefs|semrush|yandex)\b/i;

function positiveIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function empty(status = 204) {
  return new NextResponse(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function stripLocale(path: string) {
  return path.replace(/^\/(?:en|ar)(?=\/|$)/, "") || "/";
}

function isTrackablePath(path: string) {
  const normalized = stripLocale(path);
  return !STATIC_EXT_RE.test(normalized) && !BLOCKED_PATHS.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function countryFromHeaders(headers: Headers) {
  const country =
    headers.get("cf-ipcountry") ||
    headers.get("x-vercel-ip-country") ||
    headers.get("cloudfront-viewer-country") ||
    "";
  const code = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) || code === "T1" ? code : null;
}

function cleanPath(value: unknown) {
  const raw = typeof value === "string" ? value : "/";
  const path = raw.startsWith("/") ? raw : "/";
  return path.split(/[?#]/, 1)[0].slice(0, 300) || "/";
}

function cleanCampaign(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !CAMPAIGN_RE.test(value)) return undefined;
  return value;
}

function isAcquisitionSource(value: string): value is AcquisitionSource {
  return (ACQUISITION_SOURCES as readonly string[]).includes(value);
}

async function readPayload(request: Request) {
  // Streaming byte cap: Content-Length alone is client-controlled and can be
  // absent under chunked encoding, so enforce the limit on the stream itself.
  const result = await readBoundedJson(request, JSON_LIMIT_BYTES);
  if (!result.ok || !result.value || typeof result.value !== "object" || Array.isArray(result.value)) {
    return null;
  }
  return result.value as Record<string, unknown>;
}

export async function POST(request: Request) {
  const headers = request.headers;
  const userAgent = headers.get("user-agent") || "";

  if (headers.get("dnt") === "1" || headers.get("sec-gpc") === "1") return empty();
  if (BOT_UA_RE.test(userAgent)) return empty();

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return empty();

  const payload = await readPayload(request);
  if (!payload) return empty();

  const visitorId = typeof payload.visitorId === "string" ? payload.visitorId.trim() : "";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const eventType =
    payload.eventType === "engagement"
      ? "engagement"
      : payload.eventType === "pageview"
        ? "pageview"
        : payload.eventType === "product"
          ? "product"
          : null;
  const eventName = eventType === "product" && isProductEventName(payload.eventName) ? payload.eventName : null;
  const path = cleanPath(payload.path);
  const acquisitionSource = typeof payload.acquisitionSource === "string" ? payload.acquisitionSource : "";
  const campaign = cleanCampaign(payload.campaign);

  if (
    !ID_RE.test(visitorId) ||
    !ID_RE.test(sessionId) ||
    !eventType ||
    (eventType === "product" && !eventName) ||
    !isTrackablePath(path) ||
    !isAcquisitionSource(acquisitionSource) ||
    campaign === undefined
  ) {
    return empty();
  }

  await ensureAnalyticsSchema();
  const sourceLimited = await rateLimitOr429({
    key: `analytics:source:${clientIp(request)}`,
    limit: positiveIntEnv("EWC_ANALYTICS_SOURCE_RATE_LIMIT_PER_HOUR", 600),
    windowSec: 3600,
  });
  if (sourceLimited) return sourceLimited;

  const visitorLimited = await rateLimitOr429({
    key: `analytics:${visitorId}`,
    limit: positiveIntEnv("EWC_ANALYTICS_VISITOR_RATE_LIMIT_PER_HOUR", 300),
    windowSec: 3600,
  });
  if (visitorLimited) return visitorLimited;

  try {
    if (eventType === "product" && eventName) {
      await recordProductAnalyticsEvent({
        visitorId,
        sessionId,
        eventName,
        path,
        acquisitionSource,
        campaign,
        country: countryFromHeaders(headers),
      });
    } else if (eventType === "pageview" || eventType === "engagement") {
      await recordAnalyticsEvent({
        visitorId,
        sessionId,
        eventType,
        path,
        acquisitionSource,
        campaign,
        country: countryFromHeaders(headers),
        userAgent,
        durationSeconds: Number(payload.durationSeconds || 0),
      });
    }
  } catch (error) {
    console.error("[analytics] failed to record event", error);
  }

  return empty();
}
