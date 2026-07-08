import "server-only";

import { NextResponse } from "next/server";
import { consumeRateLimit } from "@bot/db/ewcRateLimits.js";

export function isPublicMcpEnabled() {
  return process.env.EWC_PUBLIC_MCP_ENABLED !== "false";
}

function parseOrigins(value: string | undefined): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

export function publicMcpAllowedOrigins(): Set<string> {
  return parseOrigins(
    process.env.EWC_PUBLIC_MCP_ALLOWED_ORIGINS ||
      process.env.EWC_DASHBOARD_PUBLIC_URL ||
      "",
  );
}

export function publicMcpOriginOr403(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const host = request.headers.get("host");
  const allowed = publicMcpAllowedOrigins();
  try {
    const url = new URL(origin);
    if (host && url.host === host) return null;
    if (allowed.has(url.origin)) return null;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function publicMcpClientKey(request: Request) {
  const trustedIp = request.headers.get("cf-connecting-ip")?.trim();
  const value = trustedIp ? trustedIp.toLowerCase().slice(0, 120) : "unknown";
  return `public-mcp:${value}`;
}

export async function resolvePublicMcpAccess(request: Request): Promise<NextResponse | null> {
  if (!isPublicMcpEnabled()) {
    return NextResponse.json({ error: "Public MCP is disabled" }, { status: 404 });
  }

  const originBlocked = publicMcpOriginOr403(request);
  if (originBlocked) return originBlocked;

  const limited = (await consumeRateLimit({
    key: publicMcpClientKey(request),
    limit: Math.max(1, Number(process.env.EWC_PUBLIC_MCP_RATE_LIMIT_PER_MINUTE) || 60),
    windowSec: 60,
  })) as { allowed: boolean; retryAfterSec: number };

  if (!limited.allowed) {
    const retry = Math.max(1, limited.retryAfterSec);
    return NextResponse.json(
      { error: `Too many requests - try again in ${retry} seconds.` },
      { status: 429, headers: { "Retry-After": String(retry) } },
    );
  }

  return null;
}
