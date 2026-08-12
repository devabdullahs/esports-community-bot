import { beforeAll, describe, expect, test, vi } from "vitest";

// These are control-flow tests, not stress tests: the property that matters is whether the
// PRIVATE cached loader was invoked at all. A 404 alone proves nothing — the finding is that
// a miss had already minted a persistent cache entry by the time the 404 was decided.
const MISS_CORPUS = 25;

const cachedLoaderCalls: string[] = [];
const cacheStore = new Map<string, string>();

vi.mock("next/cache", () => ({
  // Records which named cache was invoked and with what, then serves it like Next does.
  //
  // The serialization is the point, not incidental detail: Next persists a cache value as JSON,
  // so a warm read never returns the object the callback built. A pass-through mock hides that
  // — a cached `Set` passes cold and comes back as `{}` in production the moment an entry goes
  // warm. Round-tripping here makes that failure surface in the suite instead.
  unstable_cache: (fn: (...args: unknown[]) => unknown, keyParts: string[] = []) =>
    async (...args: unknown[]) => {
      const key = `${keyParts.join("/")}(${JSON.stringify(args)})`;
      cachedLoaderCalls.push(key);
      const warm = cacheStore.get(key);
      if (warm !== undefined) return JSON.parse(warm);
      const serialized = JSON.stringify(await fn(...args));
      cacheStore.set(key, serialized);
      return JSON.parse(serialized);
    },
  revalidateTag: () => {},
}));

let getGameCached: typeof import("@/lib/games").getGameCached;
let getMediaChannelCached: typeof import("@/lib/media").getMediaChannelCached;
let getPublishedNewsPostCached: typeof import("@/lib/news").getPublishedNewsPostCached;
let listPublishedNewsPostsCached: typeof import("@/lib/news").listPublishedNewsPostsCached;
let getTournamentMatchesCached: typeof import("@/lib/tournaments").getTournamentMatchesCached;

beforeAll(async () => {
  ({ getGameCached } = await import("@/lib/games"));
  ({ getMediaChannelCached } = await import("@/lib/media"));
  ({ getPublishedNewsPostCached, listPublishedNewsPostsCached } = await import("@/lib/news"));
  ({ getTournamentMatchesCached } = await import("@/lib/tournaments"));
});

function callsMatching(fragment: string) {
  return cachedLoaderCalls.filter((call) => call.startsWith(fragment));
}

describe("public cache admission", () => {
  test("unknown game and media slugs create no per-object cache entry", async () => {
    cachedLoaderCalls.length = 0;

    for (let i = 0; i < MISS_CORPUS; i += 1) {
      expect(await getGameCached(`no-such-game-${i}`)).toBeNull();
      expect(await getMediaChannelCached(`no-such-media-${i}`)).toBeNull();
    }

    // The fixed-key lists may be consulted; nothing may be keyed by the requested slug.
    expect(callsMatching("games-get")).toHaveLength(0);
    expect(callsMatching("media-get")).toHaveLength(0);
    for (const call of cachedLoaderCalls) {
      expect(call).not.toContain("no-such-game-");
      expect(call).not.toContain("no-such-media-");
    }
  });

  test("unknown post IDs and game slugs create no news detail or per-slug cache entry", async () => {
    cachedLoaderCalls.length = 0;

    for (let i = 0; i < MISS_CORPUS; i += 1) {
      expect(await getPublishedNewsPostCached(900_000 + i)).toBeNull();
      expect(await listPublishedNewsPostsCached(`no-such-game-${i}`, "en")).toEqual([]);
    }

    expect(callsMatching("news-get-published")).toHaveLength(0);
    expect(callsMatching("news-list-published(")).toHaveLength(0);
    for (const call of cachedLoaderCalls) {
      expect(call).not.toContain("900000");
      expect(call).not.toContain("no-such-game-");
    }
  });

  test("unknown tournament IDs never reach the snapshot cache", async () => {
    cachedLoaderCalls.length = 0;

    for (let i = 0; i < MISS_CORPUS; i += 1) {
      expect(await getTournamentMatchesCached(9_000_000 + i)).toBeNull();
    }

    expect(callsMatching("tournament-snapshot")).toHaveLength(0);
  });

  test("pagination and options never change the tournament snapshot key", async () => {
    cachedLoaderCalls.length = 0;

    // Whether or not a tournament exists in this fixture DB, the invariant under test is the
    // KEY: no snapshot call may carry a limit, an offset, or an options object.
    await getTournamentMatchesCached(1, { limit: 10, offset: 0 });
    await getTournamentMatchesCached(1, { limit: 50, offset: 100 });
    await getTournamentMatchesCached(1, { includeBracket: true });

    for (const call of callsMatching("tournament-snapshot")) {
      expect(call).not.toContain("limit");
      expect(call).not.toContain("offset");
      expect(call).not.toContain("includeBracket");
      // Exactly one argument: the canonical numeric ID.
      expect(call).toMatch(/tournament-snapshot\(\[\d+\]\)$/);
    }
  });

  test("the admission inventory still works once its own cache entry is warm", async () => {
    // Admission reads its inventory from the cache too, so whatever it holds has to survive a
    // JSON round trip. A `Set` does not: the first read gets the real object, every read after
    // gets `{}`, and the check throws instead of failing closed — only in production, and only
    // after the entry warms up.
    cachedLoaderCalls.length = 0;
    expect(await getPublishedNewsPostCached(990_001)).toBeNull();
    expect(await getPublishedNewsPostCached(990_002)).toBeNull();
    expect(await getPublishedNewsPostCached(990_003)).toBeNull();

    expect(callsMatching("news-published-id-inventory").length).toBeGreaterThan(1);
    expect(callsMatching("news-get-published")).toHaveLength(0);
  });

  test("free-text search and visitor news pages are not persistent cache keys", async () => {
    cachedLoaderCalls.length = 0;
    const { searchPublishedNewsPostsUncached, listLatestPublishedNewsPosts_uncachedPage } =
      await import("@/lib/news");

    await searchPublishedNewsPostsUncached("attacker chosen phrase", "en", "", "", false, 5, 0);
    await listLatestPublishedNewsPosts_uncachedPage("en", 5, false, 4_000);

    expect(callsMatching("news-search-published")).toHaveLength(0);
    expect(callsMatching("news-list-latest")).toHaveLength(0);
    for (const call of cachedLoaderCalls) {
      expect(call).not.toContain("attacker chosen phrase");
      expect(call).not.toContain("4000");
    }
  });
});
