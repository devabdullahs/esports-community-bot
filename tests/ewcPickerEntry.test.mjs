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
const { upsertEwcWeek, setEwcWeekStatus } = await import('../src/db/ewcPredictions.js');
const { currentOpenWeek } = await import('../src/commands/ewc_predict.js');

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
