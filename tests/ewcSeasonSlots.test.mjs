import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-season-slots-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { getSeasonPrediction, upsertEwcSeason, upsertSeasonClubPick } = await import('../src/db/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('upsertSeasonClubPick fills ordered slots and replaces in place', async () => {
  const guildId = 'guild-season-slots';
  const season = '2026';
  const userId = '300000000000000101';

  await upsertEwcSeason({
    guildId,
    season,
    label: 'Slot Season',
    topSize: 3,
    createdBy: 'admin',
  });

  await upsertSeasonClubPick({ guildId, season, userId, index: 0, pick: 'A' });
  await upsertSeasonClubPick({ guildId, season, userId, index: 1, pick: 'B' });
  await upsertSeasonClubPick({ guildId, season, userId, index: 2, pick: 'C' });

  const filled = await getSeasonPrediction(guildId, season, userId);
  assert.deepEqual(filled.picks, ['A', 'B', 'C']);

  // Setting an existing slot REPLACES it without growing the list.
  await upsertSeasonClubPick({ guildId, season, userId, index: 1, pick: 'Z' });

  const replaced = await getSeasonPrediction(guildId, season, userId);
  assert.deepEqual(replaced.picks, ['A', 'Z', 'C']);
  assert.equal(replaced.picks.length, 3);
});
