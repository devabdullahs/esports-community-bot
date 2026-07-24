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
  getEwcSeason,
  getEwcWeek,
  getWeeklyPrediction,
  reopenEwcWeek,
  setEwcWeekResults,
  upsertEwcSeason,
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

  await Promise.all([runEwcPredictionAutomation(), runEwcPredictionAutomation()]);

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

  await Promise.all([runEwcPredictionAutomation(), runEwcPredictionAutomation()]);

  const scored = await getEwcWeek(guildId, '2026', 'final');
  assert.equal(scored.status, 'scored');
  assert.equal((await getWeeklyPrediction(guildId, final.id, 'member-final')).score, 1000);
  const scoredAt = scored.scored_at;

  await runEwcPredictionAutomation();

  assert.equal((await getEwcWeek(guildId, '2026', 'final')).scored_at, scoredAt);
});

test('automation revalidates edited week and season deadlines after locking', async () => {
  const now = Math.floor(Date.now() / 1000);
  const guildId = 'ewc-automation-deadline';
  const weekKey = 'edited-deadline';

  await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey,
    label: 'Edited deadline',
    closeAt: now - 60,
    scoreAfter: now - 30,
    games: [{ key: 'edited-game', game: 'Edited Game', event: 'Edited', lockAt: now - 60, endAt: now + 3600 }],
    createdBy: 'test',
  });
  await upsertEwcSeason({
    guildId,
    season: '2026',
    label: 'Edited season deadline',
    closeAt: now - 60,
    scoreAfter: now - 30,
    createdBy: 'test',
  });

  let weekEdited = false;
  let seasonEdited = false;
  await runEwcPredictionAutomation(null, {
    beforeWeekClose: async (round) => {
      if (weekEdited || round.guild_id !== guildId || round.week_key !== weekKey) return;
      weekEdited = true;
      await upsertEwcWeek({
        guildId,
        season: '2026',
        weekKey,
        label: 'Edited deadline',
        closeAt: now + 3600,
        scoreAfter: now + 7200,
        games: [{ key: 'edited-game', game: 'Edited Game', event: 'Edited', lockAt: now + 3600, endAt: now + 7200 }],
        createdBy: 'test',
      });
    },
    beforeSeasonClose: async (round) => {
      if (seasonEdited || round.guild_id !== guildId || round.season !== '2026') return;
      seasonEdited = true;
      await upsertEwcSeason({
        guildId,
        season: '2026',
        label: 'Edited season deadline',
        closeAt: now + 3600,
        scoreAfter: now + 7200,
        createdBy: 'test',
      });
    },
  });

  assert.equal(weekEdited, true);
  assert.equal((await getEwcWeek(guildId, '2026', weekKey)).status, 'open');
  assert.equal(seasonEdited, true);
  assert.equal((await getEwcSeason(guildId, '2026')).status, 'open');
});

test('automation does not score a week reopened before the scoring transaction', async () => {
  const now = Math.floor(Date.now() / 1000);
  const guildId = 'ewc-automation-reopen';
  const weekKey = 'reopened-during-scoring';
  const round = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey,
    label: 'Reopened during scoring',
    closeAt: now - 60,
    scoreAfter: now - 30,
    games: [{ key: 'reopen-game', game: 'Reopen Game', event: 'Reopen', lockAt: now - 60, endAt: now - 30 }],
    createdBy: 'test',
  });
  await upsertWeeklyPrediction({
    guildId,
    weekId: round.id,
    userId: 'member-reopen',
    picks: [{ gameKey: 'reopen-game', pick: 'Reopen One' }],
  });
  await setEwcWeekResults(round.id, [resultFor('reopen-game', 'Reopen', true, now)]);

  let reopened = false;
  await runEwcPredictionAutomation(null, {
    beforeWeekScoringTransaction: async (lockedRound) => {
      if (reopened || lockedRound.guild_id !== guildId || lockedRound.week_key !== weekKey) return;
      reopened = true;
      await reopenEwcWeek(lockedRound.id);
    },
  });

  assert.equal(reopened, true);
  assert.equal((await getEwcWeek(guildId, '2026', weekKey)).status, 'open');
  assert.equal((await getWeeklyPrediction(guildId, round.id, 'member-reopen')).score, null);
});
