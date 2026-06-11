import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-delete-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  deleteEwcWeek,
  getEwcWeek,
  listWeeklyPredictions,
  upsertEwcWeek,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');

const guildId = 'guild-del-1';
const season = '2026';
const userA = '200000000000000001';
const userB = '200000000000000002';

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('deleteEwcWeek removes the week and all its predictions atomically', () => {
  const week = upsertEwcWeek({ guildId, season, weekKey: 'week-8', label: 'Week 8', createdBy: 'admin' });
  upsertWeeklyPrediction({ guildId, weekId: week.id, userId: userA, picks: ['Team A'] });
  upsertWeeklyPrediction({ guildId, weekId: week.id, userId: userB, picks: ['Team B'] });

  const result = deleteEwcWeek(week.id);

  assert.deepEqual(result, { weeks: 1, predictions: 2 });
  assert.equal(getEwcWeek(guildId, season, 'week-8'), null);
  assert.deepEqual(listWeeklyPredictions(week.id), []);
});

test('deleteEwcWeek on a week with no predictions returns predictions: 0', () => {
  const week = upsertEwcWeek({ guildId, season, weekKey: 'week-9', label: 'Week 9', createdBy: 'admin' });

  const result = deleteEwcWeek(week.id);

  assert.deepEqual(result, { weeks: 1, predictions: 0 });
  assert.equal(getEwcWeek(guildId, season, 'week-9'), null);
});
