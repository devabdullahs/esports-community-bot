import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';

const tempDir = mkdtempSync(join(tmpdir(), 'ecb-tournament-operations-'));
process.env.DB_PATH = join(tempDir, 'operations.sqlite');

const { closeDb } = await import('../src/db/index.js');
const { run } = await import('../src/db/client.js');
const {
  claimNextTournamentOperation,
  completeTournamentOperation,
  enqueueTournamentOperation,
  failTournamentOperation,
  getTournamentOperation,
  retryTournamentOperation,
  tournamentOperationIdempotencyKey,
} = await import('../src/db/tournamentOperations.js');
const {
  deactivateTournament,
  isTournamentGenerationActive,
  reactivateTournament,
  withActiveTournamentGeneration,
} = await import('../src/db/tournaments.js');
const { createLiquipediaClient } = await import('../src/services/liquipedia/client.js');
const { tournamentProviderAdmissionOptions } = await import('../src/services/tournamentProviderAdmission.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test.after(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

async function seedTournament() {
  await run(
    `INSERT INTO tournaments
       (id, source, external_id, game, name, guild_id, active, lifecycle_generation)
     VALUES (1, 'liquipedia', 'dota2/Test', 'dota2', 'Test event', '1087350030693838918', 1, 3)
     ON CONFLICT (id) DO NOTHING`,
  );
}

function validationRequest(overrides = {}) {
  return {
    guildId: '1087350030693838918',
    operation: 'validate_and_activate',
    source: 'startgg',
    sourceId: 'tournament/test-event/event/main-event',
    game: 'easportsfc',
    requestedActorType: 'web_admin',
    requestedActorId: '170115708871507970',
    requestedActorName: 'Admin',
    idempotencyKey: 'tournament:test:create:one',
    ...overrides,
  };
}

test('generated idempotency keys accept canonical Liquipedia source paths', async () => {
  const request = validationRequest({
    source: 'liquipedia',
    sourceId: 'valorant/E2E_Tournament_Operations',
    game: 'valorant',
    idempotencyKey: undefined,
  });
  const idempotencyKey = tournamentOperationIdempotencyKey(request, 'request-0001');

  assert.match(
    idempotencyKey,
    /^tournament:validate_and_activate:[a-f0-9]{24}:request-0001$/,
  );
  const queued = await enqueueTournamentOperation({ ...request, idempotencyKey });
  assert.equal(queued.created, true);
  assert.equal(queued.operation.sourceId, 'valorant/E2E_Tournament_Operations');
  const claimed = await claimNextTournamentOperation({ nowSec: 1, leaseSeconds: 60 });
  assert.equal(claimed.operation.id, queued.operation.id);
  assert.equal(
    await completeTournamentOperation({
      id: claimed.operation.id,
      leaseToken: claimed.leaseToken,
      resultCode: 'validated',
    }),
    true,
  );
});

test('idempotent enqueue, exclusive lease, terminal ownership, and retry are durable', async () => {
  await seedTournament();
  const first = await enqueueTournamentOperation(validationRequest());
  const duplicate = await enqueueTournamentOperation(validationRequest());
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.operation.id, first.operation.id);

  const claim = await claimNextTournamentOperation({ nowSec: 100, leaseSeconds: 60 });
  assert.equal(claim.operation.id, first.operation.id);
  assert.equal(await claimNextTournamentOperation({ nowSec: 101, leaseSeconds: 60 }), null);
  assert.equal(
    await completeTournamentOperation({
      id: claim.operation.id,
      leaseToken: 'not-the-owner',
      resultCode: 'completed',
    }),
    false,
  );
  assert.equal(
    await failTournamentOperation({
      id: claim.operation.id,
      leaseToken: claim.leaseToken,
      failureCode: 'parse',
    }),
    true,
  );
  assert.equal((await getTournamentOperation(first.operation.id)).status, 'failed');
  assert.equal(await retryTournamentOperation(first.operation.id), true);

  const retry = await claimNextTournamentOperation({ nowSec: 200, leaseSeconds: 60 });
  assert.equal(retry.operation.attempts, 2);
  assert.equal(
    await completeTournamentOperation({
      id: retry.operation.id,
      leaseToken: retry.leaseToken,
      resultCode: 'validated_and_activated',
      tournamentId: 1,
    }),
    true,
  );
  const completed = await getTournamentOperation(first.operation.id);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultTournamentId, 1);
});

test('expired leases recover and stale lifecycle generations cannot persist', async () => {
  await seedTournament();
  const queued = await enqueueTournamentOperation(
    validationRequest({
      operation: 'sync_schedule',
      tournamentId: 1,
      source: undefined,
      sourceId: undefined,
      game: undefined,
      idempotencyKey: 'tournament:sync:one',
    }),
  );
  const first = await claimNextTournamentOperation({ nowSec: 1_000, leaseSeconds: 60 });
  assert.equal(first.operation.id, queued.operation.id);
  const recovered = await claimNextTournamentOperation({ nowSec: 1_061, leaseSeconds: 60 });
  assert.equal(recovered.operation.id, queued.operation.id);
  assert.notEqual(recovered.leaseToken, first.leaseToken);

  const before = await withActiveTournamentGeneration(1, 3, async (tx) => {
    await tx.run('UPDATE tournaments SET name = $1 WHERE id = $2', ['Still active', 1]);
    return 'written';
  });
  assert.deepEqual(before, { applied: true, reason: null, value: 'written' });

  const deactivated = await deactivateTournament(1, '1087350030693838918');
  assert.equal(deactivated.lifecycle_generation, 4);
  assert.equal(await isTournamentGenerationActive(1, 3), false);
  const stale = await withActiveTournamentGeneration(1, 3, () => {
    throw new Error('must not execute');
  });
  assert.deepEqual(stale, {
    applied: false,
    reason: 'stale_generation',
    value: null,
  });

  const reactivated = await reactivateTournament(1, '1087350030693838918');
  assert.equal(reactivated.lifecycle_generation, 5);
  assert.equal(await isTournamentGenerationActive(1, 5), true);
});

test('deactivation while a parse waits in the shared queue prevents provider dispatch', async () => {
  await run(
    `INSERT INTO tournaments
       (id, source, external_id, game, name, guild_id, active, lifecycle_generation)
     VALUES (2, 'liquipedia', 'dota2/Queued', 'dota2', 'Queued event', '1087350030693838918', 1, 3)`,
  );

  const firstGate = deferred();
  const calls = [];
  let now = 100_000;
  const state = { lastRequestAt: 0, lastParseAt: 0, blockedUntil: 0 };
  const client = createLiquipediaClient({
    http: {
      async get(url, request) {
        calls.push({ url, request });
        if (calls.length === 1) return firstGate.promise;
        return { data: { parse: { text: { '*': '<p>unexpected</p>' } } } };
      },
    },
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    rateState: state,
    loadRateState() {},
    saveRateState() {},
    markRateLimited() {},
    log: { warn() {}, debug() {} },
  });

  const blocker = client.parsePage('dota2', 'Queue_Blocker');
  await flush();
  assert.equal(calls.length, 1);

  const queued = client.parsePage(
    'dota2',
    'Queued',
    tournamentProviderAdmissionOptions(2, 3),
  );
  await flush();
  assert.equal(calls.length, 1);

  const deactivated = await deactivateTournament(2, '1087350030693838918');
  assert.equal(deactivated.lifecycle_generation, 4);
  firstGate.resolve({ data: { parse: { text: { '*': '<p>ok</p>' } } } });
  await blocker;

  await assert.rejects(queued, (error) => error.reasonCode === 'stale_generation');
  assert.equal(calls.length, 1);
});
