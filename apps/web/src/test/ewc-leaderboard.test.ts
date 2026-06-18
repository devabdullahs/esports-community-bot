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
  test("orders rows by score desc, then user_id asc for tied scores", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.guildId).toBe(GUILD_ID);
    expect(body.season).toBe(SEASON);
    expect(body.total).toBe(4);
    expect(body.rows.map((row: { displayName: string }) => row.displayName)).toEqual([
      "Member 0301",
      "Member 0201",
      "Member 0202",
      "Member 0401",
    ]);
    expect(body.rows.map((row: { rank: number; overallPoints: number }) => [row.rank, row.overallPoints])).toEqual([
      [1, 900],
      [2, 700],
      [3, 700],
      [4, 100],
    ]);
  });

  test("paginates rows while keeping the total count", async () => {
    const firstPage = await (await GET(req("?limit=2"), ctx())).json();
    expect(firstPage.total).toBe(4);
    expect(firstPage.rows.map((row: { displayName: string }) => row.displayName)).toEqual([
      "Member 0301",
      "Member 0201",
    ]);

    const secondPage = await (await GET(req("?limit=2&offset=2"), ctx())).json();
    expect(secondPage.total).toBe(4);
    expect(secondPage.rows.map((row: { rank: number; displayName: string }) => [row.rank, row.displayName])).toEqual([
      [3, "Member 0202"],
      [4, "Member 0401"],
    ]);

    const pastEnd = await (await GET(req("?limit=2&offset=99"), ctx())).json();
    expect(pastEnd.total).toBe(4);
    expect(pastEnd.rows).toEqual([]);
  });

  test("returns an empty leaderboard for a fresh guild and season", async () => {
    const res = await GET(
      new Request(`http://localhost/api/ewc/${EMPTY_GUILD_ID}/${EMPTY_SEASON}/leaderboard`),
      ctx(EMPTY_GUILD_ID, EMPTY_SEASON),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.total).toBe(0);
  });

  test("rejects an invalid guild or season", async () => {
    const invalidGuild = await GET(req(), ctx("not-a-snowflake", SEASON));
    expect(invalidGuild.status).toBe(400);

    const invalidSeason = await GET(req(), ctx(GUILD_ID, "season-2048"));
    expect(invalidSeason.status).toBe(400);
  });
});
