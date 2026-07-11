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
  markEwcSeasonScored,
  markEwcWeekScored,
  saveSeasonPredictionScore,
  saveWeeklyPredictionScore,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertSeasonPrediction,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');
const {
  EWC_ROLE_CONNECTION_METADATA,
  buildDiscordRoleConnectionPayload,
  formatShowcaseUsername,
  getEwcRoleConnectionPayload,
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
  await markEwcSeasonScored(guildId, season, []);

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

  const week3 = await upsertEwcWeek({
    guildId,
    season,
    weekKey: 'week-3',
    label: 'Week 3',
    createdBy: 'admin',
  });
  await upsertWeeklyPrediction({ guildId, weekId: week3.id, userId: userA, picks: ['Team Falcons'] });
}

await seed();

test('builds ranked profile stats and Discord role connection payload', async () => {
  const stats = await getEwcUserProfileStats(guildId, season, userA);
  assert.equal(stats.rank, 1);
  assert.equal(stats.overallPoints, 1600);
  assert.equal(stats.weeksPredicted, 3);
  assert.equal(stats.weeksScored, 2);
  assert.equal(stats.weeklyWins, 1);
  assert.equal(stats.top3Sweeps, 1);
  assert.deepEqual(stats.topTeams, ['Team Falcons', 'T1', 'Team Vitality']);

  const payload = buildDiscordRoleConnectionPayload(stats);
  assert.equal(payload.platform_name, 'EWC Predictions');
  assert.equal(payload.metadata.overall_rank, '1');
  assert.equal(payload.metadata.overall_points, '1600');
  assert.equal(payload.metadata.weeks_scored, '3');
  assert.equal(payload.metadata.weekly_wins, '1');
  assert.equal(payload.metadata.top3_sweeps, '1');

  const activityMetadata = EWC_ROLE_CONNECTION_METADATA.find((entry) => entry.key === 'weeks_scored');
  assert.equal(activityMetadata?.name, 'Weeks Predicted');
});

test('rolling event points count overall without granting finalized-week achievements', async () => {
  const rollingSeason = 'rolling-2026';
  await upsertEwcSeason({ guildId, season: rollingSeason, label: 'Rolling', createdBy: 'admin' });
  const week = await upsertEwcWeek({
    guildId,
    season: rollingSeason,
    weekKey: 'week-1',
    label: 'Week 1',
    createdBy: 'admin',
  });
  await upsertWeeklyPrediction({ guildId, weekId: week.id, userId: userA, picks: ['Team Falcons'] });
  await saveWeeklyPredictionScore(guildId, week.id, userA, 750, { provisional: true, bonus: 0 });

  const stats = await getEwcUserProfileStats(guildId, rollingSeason, userA);
  assert.equal(stats.overallPoints, 750);
  assert.equal(stats.weeksPredicted, 1);
  assert.equal(stats.weeksScored, 0);
  assert.equal(stats.weeklyWins, 0);
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

test('hides season picks from public profile surfaces before season lock', async () => {
  const hiddenSeason = '2027';
  await upsertEwcSeason({
    guildId,
    season: hiddenSeason,
    label: 'EWC 2027',
    closeAt: Math.floor(Date.now() / 1000) + 86400,
    topSize: 5,
    createdBy: 'admin',
  });
  await upsertSeasonPrediction({
    guildId,
    season: hiddenSeason,
    userId: userA,
    picks: ['Team Falcons', 'Team Liquid', 'Team Vitality', 'T1', 'Gen.G'],
  });

  const publicStats = await getEwcUserProfileStats(guildId, hiddenSeason, userA);
  assert.deepEqual(publicStats.topTeams, []);
  assert.deepEqual(publicStats.seasonPicks, []);
  assert.equal(publicStats.seasonPicksHidden, true);
  assert.match(publicStats.showcaseUsername, /picks hidden/);
  assert.doesNotMatch(publicStats.showcaseUsername, /Team Falcons/);

  const rolePayload = await getEwcRoleConnectionPayload(guildId, hiddenSeason, userA);
  assert.doesNotMatch(rolePayload.platform_username, /Team Falcons/);

  const ownerStats = await getEwcUserProfileStats(guildId, hiddenSeason, userA, { includeHiddenPicks: true });
  assert.deepEqual(ownerStats.topTeams, ['Team Falcons', 'Team Liquid', 'Team Vitality']);
  assert.deepEqual(ownerStats.seasonPicks.slice(0, 3), ['Team Falcons', 'Team Liquid', 'Team Vitality']);
});
