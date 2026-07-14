import { beforeAll, describe, expect, test } from "vitest";
import { GET } from "@/app/api/search/route";
import {
  PUBLIC_SEARCH_KINDS,
  PUBLIC_SEARCH_QUERY_MAX_LENGTH,
  getPublicSearchResults,
  parsePublicSearchQuery,
  publicSearchHref,
  type PublicSearchResponse,
} from "@/lib/public-search";

const GUILD_ID = "611111111111111111";
const GAME_SLUG = "global-search-fixture";

function searchRequest(query: string, locale = "en", ip = "203.0.113.210", extra = "") {
  const params = new URLSearchParams({ q: query, locale });
  return new Request(`http://localhost/api/search?${params.toString()}${extra}`, {
    headers: { "cf-connecting-ip": ip },
  });
}

function allResults(response: PublicSearchResponse) {
  return PUBLIC_SEARCH_KINDS.flatMap((kind) => response.results[kind]);
}

function serializedKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(serializedKeys);
  return Object.entries(value).flatMap(([key, child]) => [key, ...serializedKeys(child)]);
}

beforeAll(async () => {
  process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = GUILD_ID;
  await import("@bot/db/index.js");

  const { createEwcGame } = await import("@bot/db/ewcGames.js");
  await createEwcGame({
    slug: GAME_SLUG,
    title: { en: "Search Arena", ar: "\u0633\u0627\u062d\u0629 \u0627\u0644\u0628\u062d\u062b" },
    description: { en: "", ar: "" },
    status: { en: "Open", ar: "\u0645\u0641\u062a\u0648\u062d" },
    owner: { en: "", ar: "" },
    focus: [],
  });

  const { upsertTeam, saveTeamLiquipedia } = await import("@bot/db/teams.js");
  const team = await upsertTeam({
    game: GAME_SLUG,
    pandascore_id: 989001,
    name: "Search Team 01",
    slug: "search-team-01",
    raw_json: { fixture: "private-team-data" },
  });
  await saveTeamLiquipedia(team.id, {
    raw: "private team enrichment",
    facts: { hidden: true },
  });
  for (let index = 2; index <= 6; index += 1) {
    await upsertTeam({
      game: GAME_SLUG,
      pandascore_id: 989000 + index,
      name: `Search Team 0${index}`,
      slug: `search-team-0${index}`,
    });
  }
  await upsertTeam({
    game: GAME_SLUG,
    pandascore_id: 989007,
    name: "A Search Team Contains",
    slug: "a-search-team-contains",
  });

  const { upsertPlayer, savePlayerLiquipedia } = await import("@bot/db/players.js");
  const player = await upsertPlayer({
    game: GAME_SLUG,
    pandascore_id: 989101,
    name: "Search Player",
    slug: "search-player",
    current_team_id: team.id,
    current_team_name: team.name,
    raw_json: { fixture: "private-player-data" },
  });
  await savePlayerLiquipedia(player.id, {
    raw: "private player enrichment",
    facts: { hidden: true },
  });

  const { addTournament } = await import("@bot/db/tournaments.js");
  const tournament = await addTournament({
    source: "liquipedia",
    external_id: "global-search-fixture",
    game: GAME_SLUG,
    name: "Search Invitational",
    url: "https://liquipedia.net/valorant/Search_Invitational",
    guild_id: GUILD_ID,
  });
  const { upsertMatch } = await import("@bot/db/matches.js");
  await upsertMatch({
    tournament_id: tournament.id,
    source: "liquipedia",
    external_id: "global-search-match",
    name: "Search Squad vs Rival",
    team_a: "Search Squad",
    team_b: "Rival",
    status: "running",
    scheduled_at: 1_900_000_000,
  });

  const { createEwcNewsPost } = await import("@bot/db/ewcNewsPosts.js");
  await createEwcNewsPost({
    gameSlug: GAME_SLUG,
    contentMode: "shared",
    defaultLocale: "en",
    translations: {
      en: { title: "Search Update", summary: "Public search fixture", body: "Visible to the public." },
    },
    status: "published",
  });
  await createEwcNewsPost({
    gameSlug: GAME_SLUG,
    contentMode: "shared",
    defaultLocale: "en",
    translations: {
      en: { title: "Search Draft", summary: "Must not leak", body: "Private draft fixture." },
    },
    status: "draft",
  });
});

describe("public search model", () => {
  test("normalizes bounded queries and strips generated href suffixes", () => {
    expect(parsePublicSearchQuery("  Search\n Arena ")).toEqual({
      value: "Search Arena",
      normalized: "search arena",
    });
    expect(parsePublicSearchQuery("x")).toBeNull();
    expect(parsePublicSearchQuery("x".repeat(PUBLIC_SEARCH_QUERY_MAX_LENGTH + 1))).toBeNull();
    expect(publicSearchHref("/teams/12?draft=yes#hidden", "ar")).toBe("/ar/teams/12");
  });

  test("returns every public kind, ranks prefixes before contains, and caps groups", async () => {
    const response = await getPublicSearchResults("Search", "en");
    for (const kind of PUBLIC_SEARCH_KINDS) {
      expect(response.results[kind].some((result) => result.kind === kind)).toBe(true);
      expect(response.results[kind].length).toBeLessThanOrEqual(5);
    }
    expect(response.results.team.map((team) => team.title)).toEqual([
      "Search Team 01",
      "Search Team 02",
      "Search Team 03",
      "Search Team 04",
      "Search Team 05",
    ]);
    expect(allResults(response).length).toBeLessThanOrEqual(24);
  });

  test("uses locale-safe paths and never serializes draft or enrichment fields", async () => {
    const response = await getPublicSearchResults("Search", "ar");
    const serialized = JSON.stringify(response);
    const keys = serializedKeys(response);
    expect(response.results.game.some((result) => result.title === "\u0633\u0627\u062d\u0629 \u0627\u0644\u0628\u062d\u062b")).toBe(true);
    expect(allResults(response).every((result) => result.href.startsWith("/ar/") && !/[?#]/u.test(result.href))).toBe(true);
    expect(serialized).not.toContain("Search Draft");
    expect(keys).not.toEqual(expect.arrayContaining(["raw_json", "liquipedia_raw", "discord", "session"]));
    expect(serialized).not.toMatch(/private-(?:team|player)-data|private (?:team|player) enrichment/i);
  });
});

describe("GET /api/search", () => {
  test("rejects malformed, short, oversized, duplicate, and unknown query inputs without caching errors", async () => {
    const requests = [
      new Request("http://localhost/api/search?locale=en"),
      searchRequest("x"),
      searchRequest("x".repeat(PUBLIC_SEARCH_QUERY_MAX_LENGTH + 1)),
      searchRequest("%%"),
      new Request("http://localhost/api/search?q=Search&q=Again&locale=en"),
      new Request("http://localhost/api/search?q=Search&locale=en&scope=admin"),
    ];
    for (const request of requests) {
      const response = await GET(request);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  test("accepts Arabic and injection-like strings as literal bounded search text", async () => {
    const arabic = await GET(searchRequest("\u0628\u062d\u062b", "ar", "203.0.113.211"));
    expect(arabic.status).toBe(200);
    await expect(arabic.json()).resolves.toMatchObject({
      results: { game: expect.arrayContaining([expect.objectContaining({ title: "\u0633\u0627\u062d\u0629 \u0627\u0644\u0628\u062d\u062b" })]) },
    });

    const injection = await GET(searchRequest("' OR 1=1 --", "en", "203.0.113.212"));
    expect(injection.status).toBe(200);
    const body = (await injection.json()) as PublicSearchResponse;
    expect(allResults(body)).toEqual([]);
  });

  test("returns only bounded public results, ignores authorization, and rate limits trusted client IPs", async () => {
    const authorized = await GET(new Request("http://localhost/api/search?q=Search&locale=en", {
      headers: {
        Authorization: "Bearer ignored-by-public-search",
        "cf-connecting-ip": "203.0.113.213",
      },
    }));
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("Cache-Control")).toContain("public");
    const body = (await authorized.json()) as PublicSearchResponse;
    expect(allResults(body).length).toBeLessThanOrEqual(24);
    expect(PUBLIC_SEARCH_KINDS.every((kind) => body.results[kind].length <= 5)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Search Draft");

    const previousLimit = process.env.EWC_PUBLIC_SEARCH_RATE_LIMIT_PER_MINUTE;
    process.env.EWC_PUBLIC_SEARCH_RATE_LIMIT_PER_MINUTE = "1";
    try {
      expect((await GET(searchRequest("Search", "en", "203.0.113.214"))).status).toBe(200);
      const limited = await GET(searchRequest("Search", "en", "203.0.113.214"));
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
      expect(limited.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      process.env.EWC_PUBLIC_SEARCH_RATE_LIMIT_PER_MINUTE = previousLimit;
    }
  });
});
