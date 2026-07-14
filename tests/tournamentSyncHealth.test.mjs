import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';

const tempDir = mkdtempSync(join(tmpdir(), 'ecb-sync-health-'));
const dbPath = join(tempDir, 'pre-plan.sqlite');
process.env.DB_PATH = dbPath;

// Model a database created before this plan, then let the normal schema module
// add the new table without disturbing already-stored tournament data.
const prePlanDb = new Database(dbPath);
prePlanDb.pragma('foreign_keys = ON');
prePlanDb.exec(`
  CREATE TABLE tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    game TEXT,
    name TEXT,
    url TEXT,
    guild_id TEXT NOT NULL,
    added_by TEXT,
    ewc INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    archived_at INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, external_id, guild_id)
  );
  INSERT INTO tournaments (id, source, external_id, guild_id, name)
  VALUES (1, 'liquipedia', 'pre-plan-event', 'guild-1', 'Pre-plan event');
`);
prePlanDb.close();

const { db, closeDb } = await import('../src/db/index.js');
const {
  getTournamentSyncHealth,
  listTournamentSyncHealth,
  recordTournamentSyncFailure,
  recordTournamentSyncSuccess,
} = await import('../src/db/tournamentSyncHealth.js');
const { fetchTournamentSchedule } = await import('../src/jobs/tournamentScheduleFetch.js');
const {
  categorizeTournamentSyncError,
  classifyTournamentSyncHealth,
  publicTournamentSyncHealth,
  tournamentSyncWindows,
} = await import('../src/lib/tournamentSyncHealth.js');

function addTournament(id, source = 'liquipedia') {
  db.prepare(
    `INSERT INTO tournaments (id, source, external_id, guild_id, name)
     VALUES (?, ?, ?, 'guild-1', ?)`,
  ).run(id, source, `event-${id}`, `Event ${id}`);
  return { id, source, external_id: `event-${id}` };
}

test.after(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

test('adds the sync-health schema to a pre-plan database without losing tournament data', async () => {
  const original = db.prepare('SELECT id, name FROM tournaments WHERE id = 1').get();
  assert.deepEqual(original, { id: 1, name: 'Pre-plan event' });

  const columns = db.prepare('PRAGMA table_info(tournament_sync_health)').all().map((column) => column.name);
  assert.deepEqual(columns, [
    'tournament_id',
    'source',
    'last_attempt_at',
    'last_success_at',
    'last_failure_at',
    'last_failure_category',
    'consecutive_failures',
    'last_item_count',
    'updated_at',
  ]);

  await recordTournamentSyncSuccess({ tournamentId: 1, source: 'liquipedia', itemCount: 2, at: 100 });
  assert.deepEqual(await getTournamentSyncHealth(1), {
    tournament_id: 1,
    source: 'liquipedia',
    last_attempt_at: 100,
    last_success_at: 100,
    last_failure_at: null,
    last_failure_category: null,
    consecutive_failures: 0,
    last_item_count: 2,
    updated_at: 100,
  });
});

test('records repeated failures, recovery, atomic concurrent writes, and FK deletion', async () => {
  addTournament(2, 'startgg');
  await recordTournamentSyncFailure({ tournamentId: 2, source: 'startgg', category: 'timeout', at: 110 });
  await recordTournamentSyncFailure({ tournamentId: 2, source: 'startgg', category: 'network', at: 111 });
  let health = await getTournamentSyncHealth(2);
  assert.equal(health.consecutive_failures, 2);
  assert.equal(health.last_failure_category, 'network');
  assert.equal(health.last_success_at, null);

  await recordTournamentSyncSuccess({ tournamentId: 2, source: 'startgg', itemCount: 4, at: 112 });
  health = await getTournamentSyncHealth(2);
  assert.equal(health.consecutive_failures, 0);
  assert.equal(health.last_failure_category, null);
  assert.equal(health.last_success_at, 112);
  assert.equal(health.last_item_count, 4);

  addTournament(3, 'pandascore');
  await Promise.all([
    recordTournamentSyncFailure({ tournamentId: 3, source: 'pandascore', category: 'timeout', at: 120 }),
    recordTournamentSyncFailure({ tournamentId: 3, source: 'pandascore', category: 'network', at: 121 }),
    recordTournamentSyncFailure({ tournamentId: 3, source: 'pandascore', category: 'parse', at: 122 }),
  ]);
  health = await getTournamentSyncHealth(3);
  assert.equal(health.consecutive_failures, 3);
  assert.equal(health.last_failure_category, 'parse');

  db.prepare('DELETE FROM tournaments WHERE id = ?').run(3);
  assert.equal(await getTournamentSyncHealth(3), null);
});

test('keeps the Postgres schema in parity with SQLite health columns', async () => {
  const postgresSchema = readFileSync(new URL('../scripts/postgres/schema.sql', import.meta.url), 'utf8');
  assert.match(postgresSchema, /CREATE TABLE IF NOT EXISTS tournament_sync_health/i);
  for (const column of db.prepare('PRAGMA table_info(tournament_sync_health)').all().map((row) => row.name)) {
    assert.match(postgresSchema, new RegExp(`\\b${column}\\b`, 'i'));
  }
  assert.match(postgresSchema, /REFERENCES tournaments\(id\) ON DELETE CASCADE/i);
});

test('classifies public freshness without exposing operational detail', () => {
  const now = 1_000_000;
  const running = { hasRunningMatch: true, pollIntervalMs: 300_000, nowSec: now };
  const success = { source: 'liquipedia', last_success_at: now - 600, consecutive_failures: 0 };

  assert.equal(classifyTournamentSyncHealth(success, running), 'fresh');
  assert.equal(classifyTournamentSyncHealth({ ...success, last_success_at: now - 601 }, running), 'delayed');
  assert.equal(classifyTournamentSyncHealth({ ...success, last_success_at: now - 1_800 }, running), 'delayed');
  assert.equal(classifyTournamentSyncHealth({ ...success, last_success_at: now - 1_801 }, running), 'unavailable');

  const largeInterval = tournamentSyncWindows(20 * 60 * 1000);
  assert.equal(largeInterval.freshWindowSeconds, 2_400);
  assert.ok(largeInterval.freshWindowSeconds < largeInterval.unavailableAfterSeconds);
  assert.equal(tournamentSyncWindows(-1).freshWindowSeconds, 600);

  assert.equal(
    classifyTournamentSyncHealth({ ...success, last_success_at: now - 30 * 60 * 60 }, { nowSec: now }),
    'fresh',
  );
  assert.equal(
    classifyTournamentSyncHealth({ ...success, last_success_at: now - 48 * 60 * 60 }, { nowSec: now }),
    'delayed',
  );
  assert.equal(
    classifyTournamentSyncHealth({ ...success, last_success_at: now - 48 * 60 * 60 - 1 }, { nowSec: now }),
    'unavailable',
  );
  assert.equal(classifyTournamentSyncHealth(null, running), 'unavailable');
  assert.equal(
    classifyTournamentSyncHealth({ ...success, last_success_at: now + 600 }, running),
    'fresh',
  );
  assert.equal(
    classifyTournamentSyncHealth({ ...success, consecutive_failures: 3 }, running),
    'delayed',
  );
  assert.equal(
    classifyTournamentSyncHealth({ ...success, last_success_at: now - 601, consecutive_failures: 3 }, running),
    'unavailable',
  );
  assert.equal(classifyTournamentSyncHealth(success, { ...running, archivedAt: now - 1 }), 'final');

  assert.deepEqual(
    publicTournamentSyncHealth({ ...success, last_failure_category: 'timeout', raw_error: 'do not leak' }, running),
    { state: 'fresh', lastSuccessAt: now - 600, source: 'liquipedia' },
  );
});

test('categorizes provider errors into the closed safe set', () => {
  assert.equal(categorizeTournamentSyncError({ response: { status: 429 } }), 'rate_limit');
  assert.equal(categorizeTournamentSyncError({ response: { status: 401 } }), 'auth');
  assert.equal(categorizeTournamentSyncError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), 'timeout');
  assert.equal(categorizeTournamentSyncError(Object.assign(new Error('network'), { code: 'ECONNRESET' })), 'network');
  assert.equal(categorizeTournamentSyncError(new Error('Invalid schedule response')), 'parse');
  assert.equal(categorizeTournamentSyncError(new Error('unclassified provider problem')), 'unknown');
});

test('shares one provider promise across morning/live callers and records success once', async () => {
  const tournament = addTournament(4);
  let calls = 0;
  let resolveFetch;
  const service = {
    fetchSchedule() {
      calls += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  };

  const liveCaller = fetchTournamentSchedule(service, tournament, { clock: () => 200 });
  const morningCaller = fetchTournamentSchedule(service, tournament, { clock: () => 200 });
  assert.equal(calls, 1);
  resolveFetch([{ externalId: 'match-1' }]);
  assert.deepEqual(await liveCaller, [{ externalId: 'match-1' }]);
  assert.deepEqual(await morningCaller, [{ externalId: 'match-1' }]);

  const health = await getTournamentSyncHealth(4);
  assert.equal(health.last_success_at, 200);
  assert.equal(health.last_item_count, 1);
  assert.equal(health.consecutive_failures, 0);
});

test('records one failure, rethrows it to both callers, and permits retry after cleanup', async () => {
  const tournament = addTournament(5);
  const upstream = Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' });
  let calls = 0;
  let fail = true;
  const service = {
    async fetchSchedule() {
      calls += 1;
      if (fail) throw upstream;
      return [];
    },
  };

  const results = await Promise.allSettled([
    fetchTournamentSchedule(service, tournament, { clock: () => 300 }),
    fetchTournamentSchedule(service, tournament, { clock: () => 300 }),
  ]);
  assert.equal(calls, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[0].reason, upstream);
  assert.equal(results[1].reason, upstream);
  assert.equal((await getTournamentSyncHealth(5)).last_failure_category, 'timeout');

  fail = false;
  assert.deepEqual(await fetchTournamentSchedule(service, tournament, { clock: () => 301 }), []);
  assert.equal(calls, 2);
  const health = await getTournamentSyncHealth(5);
  assert.equal(health.consecutive_failures, 0);
  assert.equal(health.last_success_at, 301);
});

test('marks a non-array schedule as a parse failure instead of treating it as success', async () => {
  const tournament = addTournament(6);
  await assert.rejects(
    fetchTournamentSchedule({ fetchSchedule: async () => ({ matches: [] }) }, tournament, { clock: () => 400 }),
    /non-array schedule/i,
  );
  const health = await getTournamentSyncHealth(6);
  assert.equal(health.last_failure_category, 'parse');
  assert.equal(health.last_success_at, null);
});

test('batch health lookup returns only requested tournament rows', async () => {
  const rows = await listTournamentSyncHealth([1, 2, 4, 999_999]);
  assert.deepEqual(rows.map((row) => row.tournament_id).sort((a, b) => a - b), [1, 2, 4]);
});
