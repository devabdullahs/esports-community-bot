import "server-only";

import { unstable_cache } from "next/cache";
import { getPublicEwcLeaderboard } from "@bot/lib/ewcProfileStats.js";

// Web-only cache (60s) over the public EWC leaderboard reads. The page and JSON
// API both call this so they share cache entries. The shared bot helper
// (src/lib/ewcProfileStats.js) stays Next-free — no next/cache import belongs
// under src/.
//
// Entries are keyed by guild/season/page-index on a fixed grid, never by the caller's
// limit/offset: those are request-controlled, and an accepted 1-100 limit crossed with an
// accepted 0-100000 offset is over ten million distinct persistent entries per namespace —
// each one a real query. Admitting the namespace bounds *which* namespaces exist; the grid
// bounds how many entries each admitted one can hold, which is the same finding one level down.

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

/** Fixed grid step. Equals the maximum accepted limit, so any accepted window spans <= 2 pages. */
const PAGE_SIZE = 100;

// PRIVATE. Nothing outside this module may invoke the cache: `unstable_cache` mints a
// persistent entry per distinct argument tuple, so a caller that forgets admission turns an
// anonymous request into an attacker-chosen cache namespace. The REST route remembered the
// check and the public MCP tool did not — which is the whole finding, and why a "check"
// function and a separately callable "load" function are no longer both exported.
//
// `pageIndex` is the only variable argument, and callers below never pass one past the last
// page the data actually has, so the entry count per namespace is ceil(total / PAGE_SIZE).
const cachedLeaderboardPage = unstable_cache(
  async (guildId: string, season: string, pageIndex: number) =>
    getPublicEwcLeaderboard({ guildId, season, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
  ["public-ewc-leaderboard-page"],
  { tags: ["ewc-public-leaderboard"], revalidate: 60 },
);

// A namespace is known only when a prediction row actually exists for it — one cheap indexed
// read, expressed in SQL both SQLite and PostgreSQL accept.
async function isKnownNamespace(guildId: string, season: string): Promise<boolean> {
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

export type PublicLeaderboard = Awaited<ReturnType<typeof cachedLeaderboardPage>>;

export type AdmittedLeaderboardResult =
  | { status: "ok"; leaderboard: PublicLeaderboard }
  | { status: "unknown-namespace" };

export type ReadPublicEwcLeaderboardDeps = {
  /** Test seam. Production always uses the private cached page loader above. */
  loadPage?: (guildId: string, season: string, pageIndex: number) => Promise<PublicLeaderboard>;
  isKnownNamespace?: (guildId: string, season: string) => Promise<boolean>;
};

/**
 * The only exported leaderboard read. Normalizes, admits, and only then caches, so an
 * unknown namespace costs one indexed lookup and creates nothing.
 *
 * There is deliberately no `skipAdmission` option: an escape hatch is the bypass again with
 * a nicer name. A second page fetch repeating the cheap admission query is the accepted cost
 * of that ownership.
 *
 * Requested windows are served by slicing canonical pages. Page 0 is always read first: it is
 * one entry per namespace and carries the authoritative `total`, which is what bounds every
 * later page index to data the namespace actually has rather than to a number the caller
 * picked. `total` and `topScore` are global in the underlying read, so taking them from page 0
 * matches what an arbitrary-offset query would have returned.
 *
 * One nuance: the underlying read disambiguates coincident display names within the rows it
 * returns, so a duplicated name split across a grid boundary is numbered per page rather than
 * per requested window. The label is stable per page instead of shifting with the offset.
 */
export async function readPublicEwcLeaderboard(
  args: PublicLeaderboardArgs,
  deps: ReadPublicEwcLeaderboardDeps = {},
): Promise<AdmittedLeaderboardResult> {
  const limit = clamp(args.limit, 1, 100, 50);
  const offset = clamp(args.offset, 0, 100_000, 0);
  const known = await (deps.isKnownNamespace ?? isKnownNamespace)(args.guildId, args.season);
  if (!known) return { status: "unknown-namespace" };

  const loadPage = deps.loadPage ?? cachedLeaderboardPage;
  const firstPage = await loadPage(args.guildId, args.season, 0);
  if (offset === 0 && limit >= PAGE_SIZE) return { status: "ok", leaderboard: firstPage };

  const total = Math.max(0, Math.floor(Number(firstPage.total)) || 0);
  const lastPageIndex = total > 0 ? Math.ceil(total / PAGE_SIZE) - 1 : 0;

  // Past the end of the data: answer from page 0's totals rather than minting an entry for a
  // page that does not exist.
  if (offset >= total) return { status: "ok", leaderboard: { ...firstPage, rows: [] } };

  const startPage = Math.min(Math.floor(offset / PAGE_SIZE), lastPageIndex);
  const endPage = Math.min(Math.floor((offset + limit - 1) / PAGE_SIZE), lastPageIndex);

  const rows = [...(startPage === 0 ? firstPage.rows : (await loadPage(args.guildId, args.season, startPage)).rows)];
  if (endPage > startPage) {
    rows.push(...(await loadPage(args.guildId, args.season, endPage)).rows);
  }

  const sliceStart = offset - startPage * PAGE_SIZE;
  return {
    status: "ok",
    leaderboard: { ...firstPage, rows: rows.slice(sliceStart, sliceStart + limit) },
  };
}
