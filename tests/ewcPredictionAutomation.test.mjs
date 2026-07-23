import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-prediction-automation-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  getEwcWeek,
  getWeeklyPrediction,
  setEwcWeekResults,
  upsertEwcWeek,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');
const { runEwcPredictionAutomation } = await import('../src/jobs/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function authoritativePlacements(prefix, complete) {
  const placements = [
    { club: `${prefix} One`, place: '1', points: 1000 },
    { club: `${prefix} Two`, place: '2', points: 750 },
    { club: `${prefix} Three`, place: '3', points: 500 },
    { club: `${prefix} Four`, place: '4', points: 300 },
  ];
  if (complete) placements.push({ club: `${prefix} Five`, place: '5-8', points: 200 });
  return placements;
}

function resultFor(gameKey, prefix, complete, fetchedAt) {
  return {
    gameKey,
    placements: authoritativePlacements(prefix, complete),
    evidence: {
      kind: 'club-points-prize-table',
      authoritative: true,
      coveredRanks: complete ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4],
    },
    fetchedAt,
  };
}

test('automation keeps partial results provisional and finalizes a complete fresh round exactly once', async () => {
  const now = Math.floor(Date.now() / 1000);
  const guildId = 'ewc-automation-131';

  const partial = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'partial',
    label: 'Partial',
    closeAt: now - 60,
    scoreAfter: now - 60,
    games: [{ key: 'partial-game', game: 'Partial Game', event: 'Partial', lockAt: now - 60, endAt: now + 86_400 }],
    createdBy: 'test',
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: partial.id,
    userId: 'member-partial',
    picks: [{ gameKey: 'partial-game', pick: 'Partial One' }],
  });
  await setEwcWeekResults(partial.id, [resultFor('partial-game', 'Partial', false, now)]);

  await runEwcPredictionAutomation();

  assert.equal((await getEwcWeek(guildId, '2026', 'partial')).status, 'closed');
  assert.equal((await getWeeklyPrediction(guildId, partial.id, 'member-partial')).details.provisional, true);

  const final = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'final',
    label: 'Final',
    closeAt: now - 60,
    scoreAfter: now - 30,
    games: [{ key: 'final-game', game: 'Final Game', event: 'Final', lockAt: now - 60, endAt: now - 30 }],
    createdBy: 'test',
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: final.id,
    userId: 'member-final',
    picks: [{ gameKey: 'final-game', pick: 'Final One' }],
  });
  await setEwcWeekResults(final.id, [resultFor('final-game', 'Final', true, now)]);

  await runEwcPredictionAutomation();

  const scored = await getEwcWeek(guildId, '2026', 'final');
  assert.equal(scored.status, 'scored');
  assert.equal((await getWeeklyPrediction(guildId, final.id, 'member-final')).score, 1000);
  const scoredAt = scored.scored_at;

  await runEwcPredictionAutomation();

  assert.equal((await getEwcWeek(guildId, '2026', 'final')).scored_at, scoredAt);
});
