import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-profile-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  markEwcWeekScored,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertSeasonPrediction,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');
const {
  buildDiscordRoleConnectionPayload,
  formatShowcaseUsername,
  getEwcUserProfileStats,
  getPublicEwcLeaderboard,
} = await import('../src/lib/ewcProfileStats.js');

const guildId = 'guild-1';
const season = '2026';
const userA = '100000000000000001';
const userB = '100000000000000002';

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function seed() {
  await upsertEwcSeason({
    guildId,
    season,
    label: 'EWC 2026',
    topSize: 10,
    createdBy: 'admin',
  });
  await upsertSeasonPrediction({
    guildId,
    season,
    userId: userA,
    picks: ['Team Falcons', 'T1', 'Team Vitality'],
  });
  await upsertSeasonPrediction({
    guildId,
    season,
    userId: userB,
    picks: ['Gen.G', 'G2 Esports', 'Natus Vincere'],
  });
  await saveSeasonPredictionScore(guildId, season, userA, 1000, { picks: [] });
  await saveSeasonPredictionScore(guildId, season, userB, 200, { picks: [] });

  const week1 = await upsertEwcWeek({
    guildId,
    season,
    weekKey: 'week-1',
    label: 'Week 1',
    createdBy: 'admin',
  });
  await upsertWeeklyPrediction({ guildId, weekId: week1.id, userId: userA, picks: ['Team Falcons', 'T1', 'Team Vitality'] });
  await upsertWeeklyPrediction({ guildId, weekId: week1.id, userId: userB, picks: ['Gen.G', 'G2 Esports', 'Natus Vincere'] });
  await saveWeeklyPredictionScore(guildId, week1.id, userA, 500, { bonus: 300 });
  await saveWeeklyPredictionScore(guildId, week1.id, userB, 200, { bonus: 0 });
  await markEwcWeekScored(week1.id, []);

  const week2 = await upsertEwcWeek({
    guildId,
    season,
    weekKey: 'week-2',
    label: 'Week 2',
    createdBy: 'admin',
  });
  await upsertWeeklyPrediction({ guildId, weekId: week2.id, userId: userA, picks: ['Team Falcons', 'T1', 'Team Vitality'] });
  await upsertWeeklyPrediction({ guildId, weekId: week2.id, userId: userB, picks: ['Gen.G', 'G2 Esports', 'Natus Vincere'] });
  await saveWeeklyPredictionScore(guildId, week2.id, userA, 100, { bonus: 0 });
  await saveWeeklyPredictionScore(guildId, week2.id, userB, 600, { bonus: 0 });
  await markEwcWeekScored(week2.id, []);
}

await seed();

test('builds ranked profile stats and Discord role connection payload', async () => {
  const stats = await getEwcUserProfileStats(guildId, season, userA);
  assert.equal(stats.rank, 1);
  assert.equal(stats.overallPoints, 1600);
  assert.equal(stats.weeksScored, 2);
  assert.equal(stats.weeklyWins, 1);
  assert.equal(stats.top3Sweeps, 1);
  assert.deepEqual(stats.topTeams, ['Team Falcons', 'T1', 'Team Vitality']);

  const payload = buildDiscordRoleConnectionPayload(stats);
  assert.equal(payload.platform_name, 'EWC Predictions');
  assert.equal(payload.metadata.overall_rank, '1');
  assert.equal(payload.metadata.overall_points, '1600');
  assert.equal(payload.metadata.weeks_scored, '2');
  assert.equal(payload.metadata.weekly_wins, '1');
  assert.equal(payload.metadata.top3_sweeps, '1');
});

test('shapes public leaderboard rows', async () => {
  const leaderboard = await getPublicEwcLeaderboard({ guildId, season, limit: 10 });
  assert.equal(leaderboard.total, 2);
  assert.equal(leaderboard.rows[0].userId, undefined);
  assert.equal(leaderboard.rows[0].rank, 1);
  assert.equal(leaderboard.rows[1].userId, undefined);
  assert.equal(leaderboard.rows[1].rank, 2);
  assert.equal(leaderboard.rows[1].weeklyWins, 1);
});

test('truncates showcase username to Discord limits', () => {
  const value = formatShowcaseUsername({
    rank: 12,
    overallPoints: 123456,
    weeksScored: 7,
    topTeams: [
      'Very Long Esports Club Name One',
      'Very Long Esports Club Name Two',
      'Very Long Esports Club Name Three',
      'Very Long Esports Club Name Four',
    ],
  });
  assert.ok(value.length <= 100);
  assert.ok(value.endsWith('...'));
});
