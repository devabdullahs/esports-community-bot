import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-operations-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

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
  getWeeklyPrediction,
  saveWeeklyPredictionScore,
  upsertEwcWeek,
  upsertWeeklyPrediction,
} = await import('../src/db/ewcPredictions.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('operation validation is closed and destructive deletion requires the exact week key', () => {
  assert.equal(validateEwcPredictionAdminOperation('drop_table', {}).ok, false);
  assert.equal(validateEwcPredictionAdminOperation('score_week', { weekKey: 'week-1', userId: 'member' }).ok, false);
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
