import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-lifecycle-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  clearWeeklyPredictionScores,
  getWeeklyPrediction,
  listWeeklyPredictions,
  overallLeaderboard,
  reopenEwcWeek,
  saveWeeklyPredictionScore,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertWeeklyGamePick,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');
const { effectiveEwcWeekStatus } = await import('../src/lib/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('upsertWeeklyGamePick overwrites an existing game pick for the same user', async () => {
  const guildId = 'guild-lifecycle-2a';
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-1',
    label: 'Week 1',
    createdBy: 'admin',
  });

  await upsertWeeklyGamePick({
    guildId,
    weekId: week.id,
    userId: '200000000000000101',
    gameKey: 'valorant-1',
    game: 'Valorant',
    event: 'EWC Valorant',
    pick: 'Team Falcons',
  });
  await upsertWeeklyGamePick({
    guildId,
    weekId: week.id,
    userId: '200000000000000101',
    gameKey: 'valorant-1',
    game: 'Valorant',
    event: 'EWC Valorant',
    pick: 'Team Heretics',
  });

  const prediction = await getWeeklyPrediction(guildId, week.id, '200000000000000101');
  assert.equal(prediction.picks.length, 1);
  assert.equal(prediction.picks[0].gameKey, 'valorant-1');
  assert.equal(prediction.picks[0].pick, 'Team Heretics');

  const rows = await listWeeklyPredictions(week.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].picks.length, 1);
  assert.equal(rows[0].picks[0].pick, 'Team Heretics');
});

test('upsertWeeklyPrediction overwrites aggregate picks and keeps users isolated', async () => {
  const guildId = 'guild-lifecycle-2b';
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-2',
    label: 'Week 2',
    createdBy: 'admin',
  });

  await upsertWeeklyPrediction({
    guildId,
    weekId: week.id,
    userId: '200000000000000201',
    picks: ['Team Falcons', 'T1', 'Gen.G'],
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: week.id,
    userId: '200000000000000201',
    picks: ['Team Liquid', 'Team Vitality', 'Twisted Minds'],
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: week.id,
    userId: '200000000000000202',
    picks: ['NAVI', 'Rex Regum Qeon', 'Virtus.pro'],
  });

  const prediction = await getWeeklyPrediction(guildId, week.id, '200000000000000201');
  assert.deepEqual(prediction.picks, ['Team Liquid', 'Team Vitality', 'Twisted Minds']);

  const rows = await listWeeklyPredictions(week.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.toSorted((a, b) => a.user_id.localeCompare(b.user_id)).map((row) => row.user_id),
    ['200000000000000201', '200000000000000202'],
  );
});

test('saveWeeklyPredictionScore overwrites scores and the reopen clear workflow nulls them', async () => {
  const guildId = 'guild-lifecycle-3a';
  const userId = '200000000000000301';
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-3',
    label: 'Week 3',
    createdBy: 'admin',
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: week.id,
    userId,
    picks: ['Team Falcons', 'T1', 'Gen.G'],
  });

  await saveWeeklyPredictionScore(guildId, week.id, userId, 100, { total: 100, pass: 1 });
  assert.equal((await getWeeklyPrediction(guildId, week.id, userId)).score, 100);

  await saveWeeklyPredictionScore(guildId, week.id, userId, 250, { total: 250, pass: 2 });
  const rescored = await getWeeklyPrediction(guildId, week.id, userId);
  assert.equal(rescored.score, 250);
  assert.deepEqual(rescored.details, { total: 250, pass: 2 });

  await reopenEwcWeek(week.id);
  await clearWeeklyPredictionScores(week.id);
  const cleared = await getWeeklyPrediction(guildId, week.id, userId);
  assert.equal(cleared.score, null);
  assert.equal(cleared.details, null);
  assert.deepEqual(cleared.picks, ['Team Falcons', 'T1', 'Gen.G']);
});

test('effectiveEwcWeekStatus derives open, closed, and scored states from status and close_at', () => {
  const now = 5_000;

  assert.equal(
    effectiveEwcWeekStatus({ status: 'open', open_at: now - 100, close_at: now + 100, games: [] }, now).label,
    'open',
  );
  assert.equal(
    effectiveEwcWeekStatus({ status: 'open', open_at: now - 200, close_at: now - 100, games: [] }, now).label,
    'closed',
  );
  assert.equal(
    effectiveEwcWeekStatus({ status: 'scored', open_at: now - 200, close_at: now - 100, games: [] }, now).label,
    'scored',
  );
});

test('overallLeaderboard counts exactly bestWeeks rows when weekly scores are tied', async () => {
  const guildId = 'guild-lifecycle-5a';
  const season = '2026-ties';
  const userId = '200000000000000501';
  const scores = [500, 500, 500, 500, 200];

  await upsertEwcSeason({
    guildId,
    season,
    label: 'Tie Season',
    bestWeeks: 3,
    createdBy: 'admin',
  });

  for (const [index, score] of scores.entries()) {
    const week = await upsertEwcWeek({
      guildId,
      season,
      weekKey: `week-${index + 1}`,
      label: `Week ${index + 1}`,
      createdBy: 'admin',
    });
    await upsertWeeklyPrediction({
      guildId,
      weekId: week.id,
      userId,
      picks: [`Pick ${index + 1}`],
    });
    await saveWeeklyPredictionScore(guildId, week.id, userId, score, { total: score });
  }

  const rows = await overallLeaderboard(guildId, season, 20, 0);

  // Current SQL tie-break for tied weekly scores is score DESC, then week_id.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, userId);
  assert.equal(rows[0].score, 1_500);
});
