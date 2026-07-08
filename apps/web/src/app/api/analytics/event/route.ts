import { NextResponse } from "next/server";
import { ensureAnalyticsSchema, recordAnalyticsEvent } from "@/lib/web-analytics";
import { clientIp } from "@/lib/community";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_LIMIT_BYTES = 2_048;
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
  return path.split("#")[0].slice(0, 300) || "/";
}

function normalizeReferrer(value: unknown, request: Request) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const requestHost = request.headers.get("host");
    if (requestHost && url.host === requestHost) return `${url.pathname}${url.search}`.slice(0, 300);
    return url.origin.slice(0, 300);
  } catch {
    return null;
  }
}

async function readPayload(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > JSON_LIMIT_BYTES) return null;
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
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
  const eventType = payload.eventType === "engagement" ? "engagement" : payload.eventType === "pageview" ? "pageview" : null;
  const path = cleanPath(payload.path);

  if (!ID_RE.test(visitorId) || !ID_RE.test(sessionId) || !eventType || !isTrackablePath(path)) return empty();

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
    await recordAnalyticsEvent({
      visitorId,
      sessionId,
      eventType,
      path,
      referrer: normalizeReferrer(payload.referrer, request),
      country: countryFromHeaders(headers),
      userAgent,
      durationSeconds: Number(payload.durationSeconds || 0),
    });
  } catch (error) {
    console.error("[analytics] failed to record event", error);
  }

  return empty();
}
