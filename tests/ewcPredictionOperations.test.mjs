import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-operations-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  claimNextEwcPredictionOperation,
  completeEwcPredictionOperation,
  enqueueEwcPredictionOperation,
  failEwcPredictionOperation,
  getEwcPredictionOperation,
  retryEwcPredictionOperation,
} = await import('../src/db/ewcPredictionOperations.js');
const { runEwcPredictionAdminOperation, validateEwcPredictionAdminOperation } = await import('../src/lib/ewcPredictionAdmin.js');
const { drainEwcPredictionOperations } = await import('../src/jobs/ewcPredictionOperations.js');
const {
  closeEwcSeason,
  closeEwcWeek,
  getEwcWeek,
  getWeeklyPrediction,
  saveWeeklyPredictionScore,
  setEwcWeekResults,
  setEwcWeekSnapshot,
  upsertEwcSeason,
  upsertEwcWeek,
  upsertWeeklyGamePick,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');
const { stableEwcGameKey } = await import('../src/lib/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('operation validation is closed and destructive deletion requires the exact week key', () => {
  assert.equal(validateEwcPredictionAdminOperation('drop_table', {}).ok, false);
  assert.equal(validateEwcPredictionAdminOperation('score_week', { weekKey: 'week-1', userId: 'member' }).ok, false);
  assert.equal(validateEwcPredictionAdminOperation('score_week', { weekKey: 'week-1', force: true }).ok, false);
  assert.equal(validateEwcPredictionAdminOperation('delete_week', { weekKey: 'week-1', confirmationWeekKey: 'week-2' }).ok, false);
  assert.deepEqual(validateEwcPredictionAdminOperation('delete_week', { weekKey: 'week-1', confirmationWeekKey: 'week-1' }), {
    ok: true,
    value: { weekKey: 'week-1', confirmationWeekKey: 'week-1' },
  });
});

test('enqueue is idempotent and only one concurrent consumer can lease work', async () => {
  const base = {
    guildId: '920000000000000301',
    season: '2026',
    operation: 'refresh_leaderboard',
    args: {},
    idempotencyKey: 'operation-dedupe-key-0001',
    requestedActorId: '200000000000000301',
  };
  const first = await enqueueEwcPredictionOperation(base);
  const second = await enqueueEwcPredictionOperation(base);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.operation.id, second.operation.id);

  const [left, right] = await Promise.all([
    claimNextEwcPredictionOperation({ nowSec: 10_000 }),
    claimNextEwcPredictionOperation({ nowSec: 10_000 }),
  ]);
  assert.equal(Boolean(left) || Boolean(right), true);
  assert.equal(Boolean(left) && Boolean(right), false);
  const claim = left || right;
  assert.equal(await completeEwcPredictionOperation({ id: claim.operation.id, leaseToken: claim.leaseToken, result: { refreshed: true } }), true);
  assert.equal((await getEwcPredictionOperation(claim.operation.id)).status, 'succeeded');
});

test('expired leases recover and failures are bounded, retryable, and never expose a stack', async () => {
  const queued = await enqueueEwcPredictionOperation({
    guildId: '920000000000000302', season: '2026', operation: 'refresh_leaderboard', args: {},
    idempotencyKey: 'operation-lease-key-00002', requestedActorId: '200000000000000302',
  });
  const first = await claimNextEwcPredictionOperation({ nowSec: 20_000, leaseSeconds: 30 });
  assert.equal(first.operation.id, queued.operation.id);
  const recovered = await claimNextEwcPredictionOperation({ nowSec: 20_031, leaseSeconds: 30 });
  assert.equal(recovered.operation.id, queued.operation.id);
  assert.notEqual(recovered.leaseToken, first.leaseToken);
  assert.equal(await failEwcPredictionOperation({ id: recovered.operation.id, leaseToken: recovered.leaseToken, error: `boom\n${'x'.repeat(800)}` }), true);
  const failed = await getEwcPredictionOperation(recovered.operation.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.includes('\n'), false);
  assert.ok(failed.error.length <= 500);
  assert.equal(await retryEwcPredictionOperation(failed.id), true);
  assert.equal((await getEwcPredictionOperation(failed.id)).status, 'queued');
});

test('shared service reopens a scored round atomically without Discord and clears scores', async () => {
  const guildId = '920000000000000303';
  const week = await upsertEwcWeek({ guildId, season: '2026', weekKey: 'week-reopen', label: 'Week reopen', status: 'scored', createdBy: 'test' });
  await upsertWeeklyPrediction({ guildId, weekId: week.id, userId: '200000000000000303', picks: ['Team Falcons'] });
  await saveWeeklyPredictionScore(guildId, week.id, '200000000000000303', 100, { total: 100 });
  let refreshed = 0;
  const result = await runEwcPredictionAdminOperation({
    guildId, season: '2026', operation: 'reopen_week', args: { weekKey: 'week-reopen' },
    effects: { refreshLeaderboard: async () => { refreshed += 1; return true; } },
  });
  assert.equal(result.round, 'week-reopen');
  assert.equal(refreshed, 1);
  assert.equal((await getWeeklyPrediction(guildId, week.id, '200000000000000303')).score, null);
});

test('shared admin scoring locks and enumerates the committed weekly predictions in one transaction', async () => {
  const guildId = '920000000000000305';
  const now = 50_000;
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-score',
    label: 'Week score',
    openAt: now - 2000,
    closeAt: now - 1000,
    scoreAfter: now - 500,
    createdBy: 'test',
  });
  const baseline = [
    { team: 'Team Falcons', rank: 1, points: 100 },
    { team: 'T1', rank: 2, points: 90 },
    { team: 'Team Liquid', rank: 3, points: 80 },
  ];
  const final = [
    { team: 'Team Falcons', rank: 1, points: 130 },
    { team: 'T1', rank: 2, points: 110 },
    { team: 'Team Liquid', rank: 3, points: 100 },
  ];
  await setEwcWeekSnapshot(week.id, 'baseline', baseline);
  await closeEwcWeek(week.id);
  await upsertWeeklyPrediction({ guildId, weekId: week.id, userId: '200000000000000305', picks: ['Falcons', 'T1', 'Liquid'] });

  const result = await runEwcPredictionAdminOperation({
    guildId,
    season: '2026',
    operation: 'score_week',
    args: { weekKey: 'week-score' },
    dependencies: {
      fetchStandings: async () => ({ exists: true, standings: final }),
      nowSec: () => now,
    },
  });

  assert.equal(result.predictions, 1);
  assert.equal((await getEwcWeek(guildId, '2026', 'week-score')).status, 'scored');
  assert.equal((await getWeeklyPrediction(guildId, week.id, '200000000000000305')).score, 370);
});

test('manual per-game scoring fetches only unresolved due games and never fetches inside the transaction', async () => {
  const guildId = '920000000000000307';
  const now = 70_000;
  const games = [
    { key: 'ready-game', game: 'Ready', event: 'Ready event', lockAt: now - 1000, endAt: now - 500 },
    { key: 'missing-game', game: 'Missing', event: 'Missing event', lockAt: now - 900, endAt: now - 400 },
  ];
  const placements = (prefix) => [
    { club: `${prefix} One`, place: '1', points: 1000 },
    { club: `${prefix} Two`, place: '2', points: 750 },
    { club: `${prefix} Three`, place: '3', points: 500 },
    { club: `${prefix} Four`, place: '4', points: 300 },
    { club: `${prefix} Five`, place: '5-8', points: 200 },
  ];
  const result = (gameKey, prefix) => ({
    gameKey,
    placements: placements(prefix),
    evidence: { kind: 'club-points-prize-table', authoritative: true, coveredRanks: [1, 2, 3, 4, 5, 6, 7, 8] },
    fetchedAt: now,
  });
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'manual-per-game',
    label: 'Manual per-game',
    openAt: now - 2000,
    closeAt: now - 800,
    scoreAfter: now - 300,
    games,
    createdBy: 'test',
  });
  await closeEwcWeek(week.id);
  await setEwcWeekResults(week.id, [result('ready-game', 'Ready')]);
  await upsertWeeklyPrediction({
    guildId,
    weekId: week.id,
    userId: '200000000000000307',
    picks: [
      { gameKey: 'ready-game', pick: 'Ready One' },
      { gameKey: 'missing-game', pick: 'Missing One' },
    ],
  });

  let inTransaction = false;
  let fetchedKeys = [];
  const { transaction: realTransaction } = await import('../src/db/client.js');
  const scored = await runEwcPredictionAdminOperation({
    guildId,
    season: '2026',
    operation: 'score_week',
    args: { weekKey: 'manual-per-game' },
    dependencies: {
      nowSec: () => now,
      fetchWeekResults: async (candidates) => {
        assert.equal(inTransaction, false);
        fetchedKeys = candidates.map((game) => game.key);
        return [result('missing-game', 'Missing')];
      },
      transaction: async (callback) => realTransaction(async (client) => {
        inTransaction = true;
        try {
          return await callback(client);
        } finally {
          inTransaction = false;
        }
      }),
    },
  });

  assert.deepEqual(fetchedKeys, ['missing-game']);
  assert.equal(scored.predictions, 1);
  assert.equal((await getWeeklyPrediction(guildId, week.id, '200000000000000307')).score, 2300);
});

test('manual scoring fails closed when the round changes after its external fetch', async () => {
  const now = 80_000;
  const round = {
    id: 1,
    guild_id: 'race-guild',
    season: '2026',
    week_key: 'race-week',
    label: 'Race week',
    status: 'closed',
    open_at: now - 2000,
    close_at: now - 1000,
    score_after: now - 500,
    games: [{ key: 'race-game', game: 'Race', event: 'Race', lockAt: now - 1000, endAt: now - 600 }],
    results: [],
    final: [],
  };
  const fetched = {
    gameKey: 'race-game',
    placements: [
      { club: 'One', place: '1', points: 1000 },
      { club: 'Two', place: '2', points: 750 },
      { club: 'Three', place: '3', points: 500 },
      { club: 'Four', place: '4', points: 300 },
      { club: 'Five', place: '5-8', points: 200 },
    ],
    evidence: { kind: 'club-points-prize-table', authoritative: true, coveredRanks: [1, 2, 3, 4, 5, 6, 7, 8] },
  };
  let wrote = false;
  await assert.rejects(
    runEwcPredictionAdminOperation({
      guildId: round.guild_id,
      season: round.season,
      operation: 'score_week',
      args: { weekKey: round.week_key },
      dependencies: {
        nowSec: () => now,
        getWeek: async () => round,
        fetchWeekResults: async () => [fetched],
        transaction: async (callback) => callback({}),
        lockWeekForTransition: async () => ({ ...round, status: 'open' }),
        listWeeklyPredictions: async () => [],
        markWeekScoredWithResults: async () => { wrote = true; },
      },
    }),
    (error) => error?.reasonCode === 'round_not_closed',
  );
  assert.equal(wrote, false);
});

test('manual season scoring rejects an undersized final table without writing scores', async () => {
  const guildId = '920000000000000308';
  const now = 90_000;
  await upsertEwcSeason({
    guildId,
    season: '2027',
    label: 'Undersized season',
    openAt: now - 2000,
    closeAt: now - 1000,
    scoreAfter: now - 500,
    topSize: 3,
    createdBy: 'test',
  });
  await closeEwcSeason(guildId, '2027');
  await assert.rejects(
    runEwcPredictionAdminOperation({
      guildId,
      season: '2027',
      operation: 'score_season',
      args: {},
      dependencies: {
        nowSec: () => now,
        fetchStandings: async () => ({
          exists: true,
          standings: [
            { team: 'Team Falcons', rank: 1 },
            { team: 'T1', rank: 2 },
          ],
        }),
      },
    }),
    (error) => error?.reasonCode === 'incomplete_result',
  );
});

test('week generation reports aggregate reconciliation and preserves references across insertion', async () => {
  const guildId = '920000000000000306';
  const legacyGame = {
    key: 'valorant-1',
    game: 'Valorant',
    gameWiki: 'valorant',
    event: 'EWC Valorant',
    eventUrl: 'https://liquipedia.net/valorant/Esports_World_Cup/2026',
    startAt: 1_800_000_000,
    endAt: 1_800_086_400,
    lockAt: 1_799_996_400,
  };
  const insertedGame = {
    game: 'Dota 2',
    gameWiki: 'dota2',
    event: 'EWC Dota 2',
    eventUrl: 'https://liquipedia.net/dota2/Esports_World_Cup/2026',
    startAt: 1_800_100_000,
    endAt: 1_800_186_400,
    lockAt: 1_800_096_400,
  };
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-admin-rekey',
    label: 'Week admin rekey',
    games: [legacyGame],
    createdBy: 'test',
  });
  await upsertWeeklyGamePick({
    guildId,
    weekId: week.id,
    userId: '200000000000000306',
    gameKey: legacyGame.key,
    game: legacyGame.game,
    event: legacyGame.event,
    pick: 'Team Falcons',
    pickedAt: legacyGame.lockAt - 10,
  });
  await setEwcWeekResults(week.id, [{ gameKey: legacyGame.key, winner: 'Team Falcons' }]);

  const regenerated = [
    { ...insertedGame, key: stableEwcGameKey(insertedGame) },
    { ...legacyGame, key: stableEwcGameKey(legacyGame) },
  ];
  const result = await runEwcPredictionAdminOperation({
    guildId,
    season: '2026',
    operation: 'generate_weeks',
    args: {},
    dependencies: {
      fetchSchedule: async () => ({ events: [insertedGame, legacyGame] }),
      generateWeeks: () => [
        {
          weekKey: 'week-admin-rekey',
          label: 'Week admin rekey updated',
          events: regenerated,
        },
      ],
    },
  });

  assert.deepEqual(result.reconciliation, {
    newWeeks: 0,
    unchanged: 0,
    rekeyed: 1,
    added: 1,
    removedUnreferenced: 0,
  });
  assert.doesNotMatch(result.message, /200000000000000306|Team Falcons/);
  const saved = await getEwcWeek(guildId, '2026', 'week-admin-rekey');
  assert.deepEqual(saved.games.map((game) => game.key), regenerated.map((game) => game.key));
  assert.equal((await getWeeklyPrediction(guildId, week.id, '200000000000000306')).picks[0].gameKey, stableEwcGameKey(legacyGame));
  assert.equal(saved.results[0].gameKey, stableEwcGameKey(legacyGame));

  const before = JSON.stringify({
    games: saved.games,
    results: saved.results,
    picks: (await getWeeklyPrediction(guildId, week.id, '200000000000000306')).picks,
  });
  await assert.rejects(
    runEwcPredictionAdminOperation({
      guildId,
      season: '2026',
      operation: 'generate_weeks',
      args: {},
      dependencies: {
        fetchSchedule: async () => ({ events: [legacyGame, legacyGame] }),
        generateWeeks: () => [
          {
            weekKey: 'week-admin-rekey',
            label: 'Ambiguous schedule',
            events: [
              { ...legacyGame, key: stableEwcGameKey(legacyGame) },
              { ...legacyGame, key: 'duplicate-event-key' },
            ],
          },
        ],
      },
    }),
    /ambiguous event/i,
  );
  const after = await getEwcWeek(guildId, '2026', 'week-admin-rekey');
  assert.equal(
    JSON.stringify({
      games: after.games,
      results: after.results,
      picks: (await getWeeklyPrediction(guildId, week.id, '200000000000000306')).picks,
    }),
    before,
  );
});

test('bot consumer completes a durable refresh operation and keeps the completion audit linked to the operation id', async () => {
  const queued = await enqueueEwcPredictionOperation({
    guildId: '920000000000000304', season: '2026', operation: 'refresh_leaderboard', args: {},
    idempotencyKey: 'operation-consumer-key-03', requestedActorId: '200000000000000304',
  });
  assert.ok((await drainEwcPredictionOperations(null, { now: 40_000 })) >= 1);
  const completed = await getEwcPredictionOperation(queued.operation.id);
  assert.equal(completed.status, 'succeeded');
  const { listAdminAuditLog } = await import('../src/db/ewcAdminAuditLog.js');
  assert.equal((await listAdminAuditLog(10)).some((entry) => entry.target === queued.operation.id && entry.action === 'prediction.operation.completed'), true);
});

test('bot consumer records a safe readiness reason when a manual scoring operation is rejected', async () => {
  const guildId = '920000000000000309';
  const week = await upsertEwcWeek({
    guildId,
    season: '2026',
    weekKey: 'week-not-ready',
    label: 'Week not ready',
    status: 'open',
    createdBy: 'test',
  });
  const queued = await enqueueEwcPredictionOperation({
    guildId,
    season: '2026',
    operation: 'score_week',
    args: { weekKey: 'week-not-ready' },
    idempotencyKey: 'operation-readiness-key-04',
    requestedActorId: '200000000000000309',
  });

  assert.equal(await drainEwcPredictionOperations(null, { now: Math.floor(Date.now() / 1000) }), 0);
  const failed = await getEwcPredictionOperation(queued.operation.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /not closed/i);

  const { listAdminAuditLog } = await import('../src/db/ewcAdminAuditLog.js');
  const audit = (await listAdminAuditLog(20)).find(
    (entry) => entry.target === queued.operation.id && entry.action === 'prediction.operation.completed',
  );
  assert.equal(audit?.details?.status, 'failed');
  assert.equal(audit?.details?.reasonCode, 'round_not_closed');
  assert.equal(JSON.stringify(audit?.details).includes('placements'), false);
  assert.equal(JSON.stringify(audit?.details).includes('picks'), false);
});
