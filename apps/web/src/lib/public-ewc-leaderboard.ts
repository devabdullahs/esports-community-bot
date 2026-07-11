import "server-only";

import { unstable_cache } from "next/cache";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";

// Web-only cache (60s) over the public EWC leaderboard reads. The page and JSON
// API both call this so they share cache entries keyed by guild/season/limit/
// offset. The shared bot helper (src/lib/ewcProfileStats.js) stays Next-free —
// no next/cache import belongs under src/.

export type PublicLeaderboardArgs = {
  guildId: string;
  season: string;
  limit?: number;
  offset?: number;
};

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const cached = unstable_cache(
  async (guildId: string, season: string, limit: number, offset: number) =>
    getPublicEwcLeaderboard({ guildId, season, limit, offset }),
  ["public-ewc-leaderboard"],
  { tags: ["ewc-public-leaderboard"], revalidate: 60 },
);

// Namespace admission BEFORE the cache (ECB-SEC-003): unstable_cache mints a
// persistent entry per distinct key, so format-valid but arbitrary
// guild/season values must never reach it. A namespace is known only when a
// prediction season row actually exists for it — one cheap indexed read.
export async function isKnownEwcLeaderboardNamespace(guildId: string, season: string): Promise<boolean> {
  const { get } = await import("@bot/db/client.js");
  const query = get as (sql: string, params: unknown[]) => Promise<unknown>;
  const week = await query(
    "SELECT 1 AS x FROM ewc_prediction_weeks WHERE guild_id = $1 AND season = $2 LIMIT 1",
    [guildId, season],
  );
  if (week) return true;
  const seasonRow = await query(
    "SELECT 1 AS x FROM ewc_prediction_seasons WHERE guild_id = $1 AND season = $2 LIMIT 1",
    [guildId, season],
  );
  return Boolean(seasonRow);
}

// Same bounds as the API route so page + API normalize to identical cache keys.
export function getPublicEwcLeaderboardCached(args: PublicLeaderboardArgs) {
  const limit = clamp(args.limit, 1, 100, 50);
  const offset = clamp(args.offset, 0, 100_000, 0);
  return cached(args.guildId, args.season, limit, offset);
}
