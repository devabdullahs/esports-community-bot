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
