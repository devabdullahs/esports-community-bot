import "server-only";
import { consumeRateLimit as _consume } from "@bot/db/ewcRateLimits.js";
import { NextResponse } from "next/server";

type Result = { allowed: boolean; remaining: number; retryAfterSec: number };
const consume = _consume as (p: { key: string; limit: number; windowSec: number; amount?: number }) => Result;

/** Returns a ready 429 response when over limit, else null. */
export function rateLimitOr429(p: { key: string; limit: number; windowSec: number; amount?: number }) {
  const r = consume(p);
  if (r.allowed) return null;
  const retry = Math.max(1, r.retryAfterSec);
  return NextResponse.json(
    { error: `Too many requests — try again in ${retry} seconds.` },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}
