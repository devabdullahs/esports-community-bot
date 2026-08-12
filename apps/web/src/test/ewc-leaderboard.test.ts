import { beforeAll, describe, expect, test } from "vitest";

const GUILD_ID = "910000000000000048";
const EMPTY_GUILD_ID = "910000000000000049";
const SEASON = "2048";
const EMPTY_SEASON = "2049";

const USERS = {
  high: "300000000000000301",
  tieA: "300000000000000201",
  tieB: "300000000000000202",
  low: "300000000000000401",
  zero: "300000000000000501",
};

import { GET } from "@/app/api/ewc/[guildId]/[season]/leaderboard/route";
import { readPublicEwcLeaderboard, type PublicLeaderboard } from "@/lib/public-ewc-leaderboard";

function req(query = ""): Request {
  return new Request(`http://localhost/api/ewc/${GUILD_ID}/${SEASON}/leaderboard${query}`);
}

function ctx(guildId = GUILD_ID, season = SEASON) {
  return { params: Promise.resolve({ guildId, season }) };
}

async function seedLeaderboard(): Promise<void> {
  const {
    saveWeeklyPredictionScore,
    upsertEwcWeek,
    upsertWeeklyPrediction,
  } = await import("@bot/db/ewcPredictions.js");

  const week = await upsertEwcWeek({
    guildId: GUILD_ID,
    season: SEASON,
    weekKey: "week-1",
    label: "Week 1",
    createdBy: "web-test",
  });

  const scores = [
    [USERS.high, 900],
    [USERS.tieA, 700],
    [USERS.tieB, 700],
    [USERS.low, 100],
    [USERS.zero, 0],
  ] as const;

  for (const [userId, score] of scores) {
    await upsertWeeklyPrediction({
      guildId: GUILD_ID,
      weekId: week.id,
      userId,
      picks: [`Pick ${userId.slice(-4)}`],
    });
    await saveWeeklyPredictionScore(GUILD_ID, week.id, userId, score, { total: score });
  }
}

beforeAll(async () => {
  await seedLeaderboard();
});

describe("GET /api/ewc/[guildId]/[season]/leaderboard", () => {
  test("orders ties consistently while returning competition ranks", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.guildId).toBe(GUILD_ID);
    expect(body.season).toBe(SEASON);
    expect(body.total).toBe(5);
    expect(body.topScore).toBe(900);
    expect(body.rows.map((row: { displayName: string }) => row.displayName)).toEqual([
      "Member 0301",
      "Member 0201",
      "Member 0202",
      "Member 0401",
      "Member 0501",
    ]);
    expect(body.rows.map((row: { rank: number; overallPoints: number }) => [row.rank, row.overallPoints])).toEqual([
      [1, 900],
      [2, 700],
      [2, 700],
      [4, 100],
      [5, 0],
    ]);
  });

  test("paginates rows while keeping the total count", async () => {
    const firstPage = await (await GET(req("?limit=2&offset=0"), ctx())).json();
    expect(firstPage.total).toBe(5);
    expect(firstPage.topScore).toBe(900);
    expect(firstPage.rows.map((row: { displayName: string }) => row.displayName)).toEqual([
      "Member 0301",
      "Member 0201",
    ]);

    const secondPage = await (await GET(req("?limit=2&offset=2"), ctx())).json();
    expect(secondPage.total).toBe(5);
    expect(secondPage.topScore).toBe(900);
    expect(secondPage.rows.map((row: { rank: number; displayName: string }) => [row.rank, row.displayName])).toEqual([
      [2, "Member 0202"],
      [4, "Member 0401"],
    ]);

    const pastEnd = await (await GET(req("?limit=2&offset=99"), ctx())).json();
    expect(pastEnd.total).toBe(5);
    expect(pastEnd.topScore).toBe(900);
    expect(pastEnd.rows).toEqual([]);
  });

  test("clamps invalid limit and offset values to stable bounds", async () => {
    const minimumPage = await (await GET(req("?limit=0&offset=-20"), ctx())).json();
    expect(minimumPage.topScore).toBe(900);
    expect(minimumPage.rows.map((row: { rank: number }) => row.rank)).toEqual([1]);

    const fallbackPage = await (await GET(req("?limit=invalid&offset=invalid"), ctx())).json();
    expect(fallbackPage.topScore).toBe(900);
    expect(fallbackPage.rows.map((row: { rank: number }) => row.rank)).toEqual([1, 2, 2, 4, 5]);
  });

  test("a namespace with no prediction rounds at all is not served (hardened)", async () => {
    // Pre-hardening this returned an empty 200 and minted a cache entry per
    // arbitrary guild/season pair; unknown namespaces are now rejected
    // before the cache (ECB-SEC-003).
    const res = await GET(
      new Request(`http://localhost/api/ewc/${EMPTY_GUILD_ID}/${EMPTY_SEASON}/leaderboard`),
      ctx(EMPTY_GUILD_ID, EMPTY_SEASON),
    );
    expect(res.status).toBe(404);
  });

  test("rejects an invalid guild or season", async () => {
    const invalidGuild = await GET(req(), ctx("not-a-snowflake", SEASON));
    expect(invalidGuild.status).toBe(400);

    const invalidSeason = await GET(req(), ctx(GUILD_ID, "season-2048"));
    expect(invalidSeason.status).toBe(400);
  });
});

describe("leaderboard namespace admission", () => {
  test("format-valid but unknown guild/season returns 404 before caching", async () => {
    const unknownGuild = await GET(new Request("http://localhost/x"), ctx("999999999999999999", SEASON));
    expect(unknownGuild.status).toBe(404);
    const unknownSeason = await GET(new Request("http://localhost/x"), ctx(GUILD_ID, "1999"));
    expect(unknownSeason.status).toBe(404);
  });

  test("the known configured namespace still serves", async () => {
    const response = await GET(new Request("http://localhost/x"), ctx());
    expect(response.status).toBe(200);
  });
});

// The finding: admission lived in the REST caller, so the public MCP tool reached the cache
// without it. These assert the OWNED boundary — that an unknown namespace cannot invoke the
// private loader at all — rather than only that a 404 comes back.
describe("leaderboard cache admission", () => {
  const UNKNOWN_GUILD = "910000000000000777";
  const UNKNOWN_SEASON = "2077";

  /** Stand-in for the private cached page loader; records every persistent key it would mint. */
  function fakePages(total: number) {
    const seen: Array<[string, string, number]> = [];
    const load = async (guildId: string, season: string, pageIndex: number) => {
      seen.push([guildId, season, pageIndex]);
      const start = pageIndex * 100;
      const rows = Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (_, i) => ({
        rank: start + i + 1,
        displayName: `player-${start + i + 1}`,
      }));
      return { guildId, season, total, topScore: 999, rows } as unknown as PublicLeaderboard;
    };
    return { seen, load };
  }

  test("an unknown namespace never invokes the cached loader", async () => {
    let calls = 0;
    const result = await readPublicEwcLeaderboard(
      { guildId: UNKNOWN_GUILD, season: UNKNOWN_SEASON },
      {
        isKnownNamespace: async () => false,
        loadPage: async () => {
          calls += 1;
          throw new Error("the private cache must not be reachable for an unknown namespace");
        },
      },
    );

    expect(result.status).toBe("unknown-namespace");
    expect(calls).toBe(0);
  });

  test("request-controlled limit and offset never become cache arguments", async () => {
    // The namespace is admitted, so this is the second half of the finding: with 250 rows of
    // real data, every accepted limit/offset combination may only ever address 3 pages. Keyed
    // by limit/offset instead, these same requests would be distinct persistent entries.
    const { seen, load } = fakePages(250);
    const deps = { isKnownNamespace: async () => true, loadPage: load };

    for (const [limit, offset] of [
      [50, 0],
      [10_000, -5],
      [Number.NaN, 0.7],
      [1, 7],
      [100, 90],
      [37, 213],
      [50, 99_999],
    ] as Array<[number, number]>) {
      await readPublicEwcLeaderboard({ guildId: GUILD_ID, season: SEASON, limit, offset }, deps);
    }

    const distinct = new Set(seen.map((key) => key.join("|")));
    expect([...distinct].sort()).toEqual([
      `${GUILD_ID}|${SEASON}|0`,
      `${GUILD_ID}|${SEASON}|1`,
      `${GUILD_ID}|${SEASON}|2`,
    ]);
    // Bounded by the data, not by the accepted input range: ceil(250 / 100).
    expect(distinct.size).toBe(3);
  });

  test("an offset past the end of the data mints no entry for a page that does not exist", async () => {
    const { seen, load } = fakePages(120);

    const result = await readPublicEwcLeaderboard(
      { guildId: GUILD_ID, season: SEASON, limit: 50, offset: 100_000 },
      { isKnownNamespace: async () => true, loadPage: load },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected an admitted result");
    expect(result.leaderboard.rows).toEqual([]);
    // Totals still answer truthfully, from the one page that legitimately exists.
    expect(result.leaderboard.total).toBe(120);
    expect(seen.map((key) => key[2])).toEqual([0]);
  });

  test("sliced windows return exactly the rows a direct limit/offset query would have", async () => {
    const { load } = fakePages(250);
    const deps = { isKnownNamespace: async () => true, loadPage: load };

    for (const [limit, offset] of [
      [50, 0],
      [20, 90],
      [37, 213],
      [1, 249],
    ] as Array<[number, number]>) {
      const result = await readPublicEwcLeaderboard(
        { guildId: GUILD_ID, season: SEASON, limit, offset },
        deps,
      );
      if (result.status !== "ok") throw new Error("expected an admitted result");
      const expected = Array.from(
        { length: Math.min(limit, 250 - offset) },
        (_, i) => offset + i + 1,
      );
      expect(result.leaderboard.rows.map((row: { rank: number }) => row.rank)).toEqual(expected);
    }
  });
});
