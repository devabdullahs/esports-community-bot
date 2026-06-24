import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-picker-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { upsertEwcWeek, setEwcWeekStatus, upsertEwcSeason } = await import('../src/db/ewcPredictions.js');
const { currentOpenWeek, seasonSlotState } = await import('../src/commands/ewc_predict.js');
const { anyRoundOpen } = await import('../src/jobs/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('currentOpenWeek returns the open week, not a scored one', async () => {
  const guildId = 'guild-picker-1';
  const open = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'open-wk', label: 'Open Week', createdBy: 'admin' });
  const scored = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'scored-wk', label: 'Scored Week', createdBy: 'admin' });
  await setEwcWeekStatus(scored.id, 'scored');

  const result = await currentOpenWeek(guildId, '2026');
  assert.equal(result?.week_key, open.week_key, 'returns the open week key');
});

test('currentOpenWeek returns the soonest-closing of two open weeks', async () => {
  const guildId = 'guild-picker-2';
  const now = Math.floor(Date.now() / 1000);
  await upsertEwcWeek({ guildId, season: '2026', weekKey: 'later-wk', label: 'Later Week', closeAt: now + 7200, createdBy: 'admin' });
  const sooner = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'sooner-wk', label: 'Sooner Week', closeAt: now + 3600, createdBy: 'admin' });

  const result = await currentOpenWeek(guildId, '2026');
  assert.equal(result?.week_key, sooner.week_key, 'returns the week that closes first');
});

test('currentOpenWeek returns null when no week is open', async () => {
  const guildId = 'guild-picker-3';
  const scored = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'only-scored', label: 'Only Scored', createdBy: 'admin' });
  await setEwcWeekStatus(scored.id, 'scored');

  assert.equal(await currentOpenWeek(guildId, '2026'), null);
});

test('anyRoundOpen is true when only the season round is open (weekly week opens later)', async () => {
  const guildId = 'guild-picker-4';
  await upsertEwcSeason({ guildId, season: '2026', label: 'S', topSize: 5, createdBy: 'admin' });
  await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'future',
    label: 'F',
    openAt: Math.floor(Date.now() / 1000) + 86400,
    createdBy: 'admin',
  });

  assert.equal(await anyRoundOpen(guildId, '2026'), true);
});

test('anyRoundOpen is false with only a scored week and no season round', async () => {
  const guildId = 'guild-picker-5';
  const scored = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'scored-only', label: 'Scored Only', createdBy: 'admin' });
  await setEwcWeekStatus(scored.id, 'scored');

  assert.equal(await anyRoundOpen(guildId, '2026'), false);
});

test('seasonSlotState enforces top-down (no skipping ahead)', () => {
  // Two ranks filled → 0,1 are changeable, 2 is the next settable, 3+ are locked.
  assert.equal(seasonSlotState(['A', 'B'], 0), 'filled');
  assert.equal(seasonSlotState(['A', 'B'], 1), 'filled');
  assert.equal(seasonSlotState(['A', 'B'], 2), 'next');
  assert.equal(seasonSlotState(['A', 'B'], 3), 'locked');
  assert.equal(seasonSlotState(['A', 'B'], 9), 'locked');
  // Empty → only rank 0 is settable.
  assert.equal(seasonSlotState([], 0), 'next');
  assert.equal(seasonSlotState([], 1), 'locked');
});
