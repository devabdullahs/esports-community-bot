import { NextResponse } from "next/server";
import { clientIp } from "@/lib/community";
import { localeFromString } from "@/lib/i18n";
import { getPublicSearchResults, parsePublicSearchQuery } from "@/lib/public-search";
import { rateLimitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=30";

function publicSearchRateLimit() {
  const value = Number(process.env.EWC_PUBLIC_SEARCH_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 60;
}

function requestParams(request: Request) {
  const url = new URL(request.url);
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 2) return null;

  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    if ((key !== "q" && key !== "locale") || values.has(key)) return null;
    values.set(key, value);
  }

  const query = values.get("q");
  const locale = localeFromString(values.get("locale"));
  if (!parsePublicSearchQuery(query) || !locale) return null;
  return { query: query!, locale };
}

export async function GET(request: Request) {
  const params = requestParams(request);
  if (!params) {
    return NextResponse.json(
      { error: "Invalid search request." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const limited = await rateLimitOr429({
    key: `public-search:${clientIp(request)}`,
    limit: publicSearchRateLimit(),
    windowSec: 60,
  });
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  return NextResponse.json(await getPublicSearchResults(params.query, params.locale), {
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
