import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-pick-distribution-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  getWeeklyPickDistribution,
  setEwcWeekStatus,
  upsertEwcWeek,
  upsertWeeklyGamePick,
} = await import('../src/db/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function week(weekKey, closeAt = 2_000) {
  return upsertEwcWeek({
    guildId: 'guild-picks',
    season: '2026',
    weekKey,
    label: weekKey,
    openAt: 1_000,
    closeAt,
    games: [
      { key: 'free-fire', game: 'Free Fire', event: 'Knockout' },
      { key: 'valorant', game: 'VALORANT', event: 'Playoffs' },
    ],
    createdBy: 'admin',
  });
}

test('weekly pick distribution never returns counts before the final round lock', async () => {
  const round = await week('private-before-lock');
  await upsertWeeklyGamePick({
    guildId: 'guild-picks',
    weekId: round.id,
    userId: 'user-1',
    gameKey: 'free-fire',
    pick: 'Team Falcons',
  });

  assert.deepEqual(await getWeeklyPickDistribution('guild-picks', round.id, 1_999), {
    locked: false,
    totalPicks: 0,
    games: [],
  });
});

test('weekly pick distribution returns post-lock per-game totals, counts, and percentages', async () => {
  const round = await week('aggregate-after-lock');
  await upsertWeeklyGamePick({ guildId: 'guild-picks', weekId: round.id, userId: 'user-1', gameKey: 'free-fire', pick: 'Team Falcons' });
  await upsertWeeklyGamePick({ guildId: 'guild-picks', weekId: round.id, userId: 'user-2', gameKey: 'free-fire', pick: 'Team Falcons' });
  await upsertWeeklyGamePick({ guildId: 'guild-picks', weekId: round.id, userId: 'user-3', gameKey: 'free-fire', pick: 'Team Liquid' });

  assert.deepEqual(await getWeeklyPickDistribution('guild-picks', round.id, 2_000), {
    locked: true,
    totalPicks: 3,
    games: [
      {
        gameKey: 'free-fire',
        game: 'Free Fire',
        event: 'Knockout',
        totalPicks: 3,
        picks: [
          { pick: 'Team Falcons', count: 2, percentage: 67 },
          { pick: 'Team Liquid', count: 1, percentage: 33 },
        ],
      },
      {
        gameKey: 'valorant',
        game: 'VALORANT',
        event: 'Playoffs',
        totalPicks: 0,
        picks: [],
      },
    ],
  });
});

test('a closed or scored round exposes the aggregate even if its configured close time is later', async () => {
  const round = await week('closed-round', 5_000);
  await upsertWeeklyGamePick({ guildId: 'guild-picks', weekId: round.id, userId: 'user-4', gameKey: 'valorant', pick: 'Sentinels' });
  await setEwcWeekStatus(round.id, 'closed');

  const distribution = await getWeeklyPickDistribution('guild-picks', round.id, 2_000);
  assert.equal(distribution.locked, true);
  assert.deepEqual(distribution.games[1].picks, [{ pick: 'Sentinels', count: 1, percentage: 100 }]);

  await setEwcWeekStatus(round.id, 'scored');
  assert.equal((await getWeeklyPickDistribution('guild-picks', round.id, 2_000)).locked, true);
});
