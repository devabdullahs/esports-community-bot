import "server-only";
import { consumeRateLimit } from "@bot/db/ewcRateLimits.js";
import { NextResponse } from "next/server";

type Result = { allowed: boolean; remaining: number; retryAfterSec: number };
type RateLimitInput = { key: string; limit: number; windowSec: number; amount?: number };

/** Returns a ready 429 response when over limit, else null. */
export async function rateLimitOr429(p: RateLimitInput) {
  const r = (await consumeRateLimit(p)) as Result;
  if (r.allowed) return null;
  const retry = Math.max(1, r.retryAfterSec);
  return NextResponse.json(
    { error: `Too many requests — try again in ${retry} seconds.` },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}
