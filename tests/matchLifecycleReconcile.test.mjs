import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import test from 'node:test';

import { classifyLifecycleRows } from '../scripts/reconcile-match-lifecycle.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reconciliationScript = resolve(rootDir, 'scripts/reconcile-match-lifecycle.mjs');
const dbClientModule = pathToFileURL(resolve(rootDir, 'src/db/client.js')).href;

function seedFixture(dbPath) {
  const source = `
    await import(${JSON.stringify(pathToFileURL(resolve(rootDir, 'src/db/index.js')).href)});
    const { run } = await import(${JSON.stringify(dbClientModule)});
    await run(
      \`INSERT INTO tournaments (source, external_id, game, name, guild_id)
       VALUES ('liquipedia', 'fixture/lifecycle', 'fixture', 'Lifecycle fixture', 'fixture-guild')\`,
    );
    const tournament = await (await import(${JSON.stringify(dbClientModule)})).get(
      \`SELECT id FROM tournaments WHERE external_id = 'fixture/lifecycle'\`,
    );
    await run(
      \`INSERT INTO matches (
         tournament_id, source, external_id, team_a, team_b, score_a, score_b,
         status, winner_side, result_reason, scheduled_at
       ) VALUES
         ($1, 'liquipedia', 'fixture/inferable', 'Alpha', 'Bravo', 3, 1, 'finished', NULL, 'unknown', 1800000000),
         ($1, 'liquipedia', 'fixture/unknown', 'Charlie', 'Delta', NULL, NULL, 'finished', NULL, 'unknown', 1800000100)\`,
      [tournament.id],
    );
    await (await import(${JSON.stringify(dbClientModule)})).closeDbClient();
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: rootDir,
    env: {
      ...process.env,
      DB_DRIVER: 'sqlite',
      DATABASE_URL: '',
      DB_PATH: dbPath,
      LOG_LEVEL: 'error',
    },
  });
}

function runReconciliation(dbPath, args = []) {
  const result = spawnSync(process.execPath, [reconciliationScript, ...args], {
    encoding: 'utf8',
    cwd: rootDir,
    env: {
      ...process.env,
      DB_DRIVER: 'sqlite',
      DATABASE_URL: '',
      DB_PATH: dbPath,
      LOG_LEVEL: 'error',
    },
  });
  assert.equal(result.error, undefined);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function readRows(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(
      `SELECT external_id, winner_side, result_reason
         FROM matches
        ORDER BY external_id`,
    ).all();
  } finally {
    db.close();
  }
}

test('classifier reports evidence-backed, unknown, and invalid lifecycle rows', () => {
  const report = classifyLifecycleRows([
    { id: 1, status: 'finished', score_a: 2, score_b: 0, winner_side: null, result_reason: 'unknown' },
    { id: 2, status: 'finished', score_a: null, score_b: null, winner_side: null, result_reason: 'unknown' },
    { id: 3, status: 'mystery', score_a: null, score_b: null, winner_side: null, result_reason: 'unknown' },
    { id: 4, status: 'cancelled', score_a: null, score_b: null, winner_side: 'team1', result_reason: 'normal' },
  ]);

  assert.equal(report.inspected, 4);
  assert.equal(report.scoreInferableWinners, 1);
  assert.equal(report.scorelessUnknownFinals, 1);
  assert.equal(report.cannotUpgrade, 2);
  assert.equal(report.invalidLegacyCombinations, 3);
  assert.deepEqual(report.upgrades, [{ id: 1, winnerSide: 'team1', resultReason: 'normal' }]);
});

test('command is dry-run first, confirmation-gated, network-free, and idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-lifecycle-reconcile-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    seedFixture(dbPath);
    const before = readRows(dbPath);

    const dryRun = runReconciliation(dbPath);
    assert.equal(dryRun.status, 0);
    assert.deepEqual(readRows(dbPath), before);
    assert.match(dryRun.output, /Score-inferable winners: 1/);
    assert.match(dryRun.output, /Scoreless\/unknown finals: 1/);
    assert.match(dryRun.output, /No provider requests were made/);
    assert.doesNotMatch(dryRun.output, /Alpha|Bravo|fixture\/inferable/);

    const refused = runReconciliation(dbPath, ['--apply']);
    assert.equal(refused.status, 1);
    assert.deepEqual(readRows(dbPath), before);

    const applied = runReconciliation(dbPath, ['--apply', '--confirm-match-lifecycle']);
    assert.equal(applied.status, 0);
    assert.match(applied.output, /Applied 1 evidence-backed lifecycle upgrade/);
    assert.deepEqual(readRows(dbPath), [
      { external_id: 'fixture/inferable', winner_side: 'team1', result_reason: 'normal' },
      { external_id: 'fixture/unknown', winner_side: null, result_reason: 'unknown' },
    ]);

    const repeated = runReconciliation(dbPath, ['--apply', '--confirm-match-lifecycle']);
    assert.equal(repeated.status, 0);
    assert.match(repeated.output, /Applied 0 evidence-backed lifecycle upgrade/);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});
