import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-board-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const { upsertEwcWeek, setEwcWeekStatus, upsertWeeklyGamePick } = await import('../src/db/ewcPredictions.js');
const { openRoundParticipantIds } = await import('../src/jobs/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('openRoundParticipantIds lists OPEN-round participants by id only (no picks), excluding scored rounds', async () => {
  const guildId = 'guild-board-1';

  const openWeek = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'open-wk', label: 'Open Week', createdBy: 'admin' });
  const scoredWeek = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'scored-wk', label: 'Scored Week', createdBy: 'admin' });
  await setEwcWeekStatus(scoredWeek.id, 'scored');

  await upsertWeeklyGamePick({ guildId, weekId: openWeek.id, userId: 'U-open-1', gameKey: 'g1', game: 'Valorant', pick: 'Team Falcons' });
  await upsertWeeklyGamePick({ guildId, weekId: openWeek.id, userId: 'U-open-2', gameKey: 'g1', game: 'Valorant', pick: 'Gen.G' });
  // A scored week's participant must NOT appear in the "predicting now" list.
  await upsertWeeklyGamePick({ guildId, weekId: scoredWeek.id, userId: 'U-scored', gameKey: 'g1', game: 'Dota 2', pick: 'Team Liquid' });

  const ids = await openRoundParticipantIds(guildId, '2026');

  assert.deepEqual([...ids].sort(), ['U-open-1', 'U-open-2'], 'only open-week participants, deduped');
  assert.ok(!ids.includes('U-scored'), 'scored-round participant excluded');

  // The output is ids only — it must never carry pick text.
  const blob = JSON.stringify(ids);
  assert.ok(!/Falcons|Gen\.G|Liquid/.test(blob), 'no pick names leak into the participant list');
});

test('openRoundParticipantIds returns [] when nobody has predicted an open round', async () => {
  const guildId = 'guild-board-2';
  await upsertEwcWeek({ guildId, season: '2026', weekKey: 'empty-wk', label: 'Empty Week', createdBy: 'admin' });
  assert.deepEqual(await openRoundParticipantIds(guildId, '2026'), []);
});
