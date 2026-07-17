import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-rankings-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  overallLeaderboard,
  overallRankForUser,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  setEwcWeekStatus,
  seasonLeaderboard,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertSeasonPrediction,
  upsertWeeklyPrediction,
  weeklyLeaderboard,
} = await import('../src/db/ewcPredictions.js');
const { getEwcUserProfileStats } = await import('../src/lib/ewcProfileStats.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const scores = [100, 100, 50, 0, 0];
const users = scores.map((_, index) => `rank-user-${index + 1}`);

async function seedRankedRound({ guildId, season, weekKey, scoreValues = scores }) {
  const week = await upsertEwcWeek({ guildId, season, weekKey, label: weekKey, createdBy: 'test' });
  for (const [index, score] of scoreValues.entries()) {
    await upsertWeeklyPrediction({ guildId, weekId: week.id, userId: users[index], picks: [`Pick ${index}`] });
    await saveWeeklyPredictionScore(guildId, week.id, users[index], score, { total: score });
  }
  await setEwcWeekStatus(week.id, 'scored');
  return week;
}

test('weekly, season, and overall leaderboards use competition rank before pagination', async () => {
  const guildId = 'guild-rank-competition';
  const season = 'rank-competition';
  await upsertEwcSeason({ guildId, season, label: 'Rank Competition', createdBy: 'test' });
  const week = await seedRankedRound({ guildId, season, weekKey: 'week-1' });

  const weekly = await weeklyLeaderboard(week.id, 10, 0);
  assert.deepEqual(weekly.map((row) => Number(row.rank)), [1, 1, 3, 4, 4]);
  assert.deepEqual((await weeklyLeaderboard(week.id, 2, 2)).map((row) => Number(row.rank)), [3, 4]);
  assert.deepEqual((await weeklyLeaderboard(week.id, 2, 4)).map((row) => Number(row.rank)), [4]);

  for (const [index, score] of scores.entries()) {
    await upsertSeasonPrediction({ guildId, season, userId: users[index], picks: [`Club ${index}`] });
    await saveSeasonPredictionScore(guildId, season, users[index], score, { total: score });
  }
  assert.deepEqual((await seasonLeaderboard(guildId, season, 10, 0)).map((row) => Number(row.rank)), [1, 1, 3, 4, 4]);

  const overall = await overallLeaderboard(guildId, season, 10, 0);
  assert.deepEqual(overall.map((row) => Number(row.rank)), [1, 1, 3, 4, 4]);
  assert.deepEqual((await overallLeaderboard(guildId, season, 2, 2)).map((row) => Number(row.rank)), [3, 4]);
  assert.equal(Number((await overallRankForUser(guildId, season, users[1])).rank), 1);
  assert.equal(Number((await overallRankForUser(guildId, season, users[4])).rank), 4);
});

test('zero-point weekly ties retain leaderboard ranks but do not grant weekly wins', async () => {
  const guildId = 'guild-rank-zero-wins';
  const season = 'rank-zero-wins';
  await upsertEwcSeason({ guildId, season, label: 'Zero Wins', createdBy: 'test' });
  const zeroWeek = await seedRankedRound({ guildId, season, weekKey: 'week-zero', scoreValues: [0, 0] });
  assert.deepEqual((await weeklyLeaderboard(zeroWeek.id, 10, 0)).map((row) => Number(row.rank)), [1, 1]);

  const stats = await getEwcUserProfileStats(guildId, season, users[0]);
  assert.equal(stats.weeklyWins, 0);
  assert.deepEqual(stats.comparison.latestWeek, {
    weekKey: 'week-zero',
    label: 'week-zero',
    rank: 1,
    total: 2,
    percentile: 50,
  });
  const tiedStats = await getEwcUserProfileStats(guildId, season, users[1]);
  assert.deepEqual(tiedStats.comparison.latestWeek, stats.comparison.latestWeek);

  const positiveWeek = await seedRankedRound({ guildId, season, weekKey: 'week-positive', scoreValues: [10, 10] });
  assert.deepEqual((await weeklyLeaderboard(positiveWeek.id, 10, 0)).map((row) => Number(row.rank)), [1, 1]);
  assert.equal((await getEwcUserProfileStats(guildId, season, users[0])).weeklyWins, 1);
});
