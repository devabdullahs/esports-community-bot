import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import test from 'node:test';

import { generateEwcWeekWindows, reconcileStoredEwc2026Week } from '../src/lib/ewcPredictions.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reconciliationScript = resolve(rootDir, 'scripts/reconcile-ewc-2026-timezone.mjs');
const predictionDbModule = pathToFileURL(resolve(rootDir, 'src/db/ewcPredictions.js')).href;
const dbClientModule = pathToFileURL(resolve(rootDir, 'src/db/client.js')).href;
const oneHour = 3600;

function storedParisWeek({ game, event, shiftSeconds = oneHour }) {
  const window = generateEwcWeekWindows([{ game, event }], { openBeforeHours: 48, lockBeforeHours: 24, scoreDelayHours: 24 })[0];
  return {
    season: '2026',
    week_key: window.weekKey,
    label: window.label,
    start_at: window.startAt + shiftSeconds,
    end_at: window.endAt + shiftSeconds,
    open_at: window.openAt + shiftSeconds,
    close_at: window.closeAt + shiftSeconds,
    score_after: window.scoreAfter + shiftSeconds,
    games: window.events.map((storedGame) => ({
      ...storedGame,
      startAt: storedGame.startAt + shiftSeconds,
      endAt: storedGame.endAt + shiftSeconds,
      lockAt: storedGame.lockAt + shiftSeconds,
      preservedMetadata: { source: 'fixture' },
    })),
  };
}

function dbPayload(stored, weekKey = stored.week_key) {
  return {
    guildId: 'timezone-fixture-guild',
    season: stored.season,
    weekKey,
    label: stored.label,
    startAt: stored.start_at,
    endAt: stored.end_at,
    openAt: stored.open_at,
    closeAt: stored.close_at,
    scoreAfter: stored.score_after,
    games: stored.games,
    createdBy: 'fixture',
  };
}

function seedFixture(dbPath, fixtures) {
  const source = `
    const { upsertEwcWeek, upsertWeeklyGamePick, setEwcWeekStatus } = await import(${JSON.stringify(predictionDbModule)});
    const { closeDbClient } = await import(${JSON.stringify(dbClientModule)});
    const fixtures = ${JSON.stringify(fixtures)};
    for (const fixture of fixtures) {
      const week = await upsertEwcWeek(fixture.week);
      for (const pick of fixture.picks || []) {
        await upsertWeeklyGamePick({ ...pick, weekId: week.id, guildId: fixture.week.guildId });
      }
      if (fixture.status === 'scored') await setEwcWeekStatus(week.id, 'scored');
    }
    await closeDbClient();
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    cwd: rootDir,
    env: { ...process.env, DB_DRIVER: 'sqlite', DATABASE_URL: '', DB_PATH: dbPath, LOG_LEVEL: 'error' },
  });
}

function runReconciliation(dbPath, args = []) {
  const result = spawnSync(process.execPath, [reconciliationScript, ...args], {
    encoding: 'utf8',
    cwd: rootDir,
    env: { ...process.env, DB_DRIVER: 'sqlite', DATABASE_URL: '', DB_PATH: dbPath, LOG_LEVEL: 'error' },
  });
  assert.equal(result.error, undefined);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function readWeeks(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT week_key, start_at, end_at, open_at, close_at, score_after, status, scored_at, games_json
         FROM ewc_prediction_weeks
         ORDER BY week_key`,
      )
      .all();
  } finally {
    db.close();
  }
}

test('reconcileStoredEwc2026Week corrects one-hour drift without changing event keys, order, or metadata', () => {
  const stored = storedParisWeek({ game: 'Valorant', event: 'EWC Valorant' });
  const model = reconcileStoredEwc2026Week(stored);

  assert.equal(model.diff.week.length, 5);
  assert.equal(model.diff.games.length, 1);
  assert.deepEqual(model.corrected.games.map((game) => game.key), stored.games.map((game) => game.key));
  assert.deepEqual(
    model.corrected.games.map(({ startAt, endAt, lockAt, ...metadata }) => metadata),
    stored.games.map(({ startAt, endAt, lockAt, ...metadata }) => metadata),
  );
  assert.deepEqual(model.invalidSubmissionIntervals, [
    {
      gameKey: stored.games[0].key,
      newLockAt: stored.games[0].lockAt - oneHour,
      oldLockAt: stored.games[0].lockAt,
    },
  ]);

  const correctedStored = {
    ...stored,
    start_at: model.corrected.startAt,
    end_at: model.corrected.endAt,
    open_at: model.corrected.openAt,
    close_at: model.corrected.closeAt,
    score_after: model.corrected.scoreAfter,
    games: model.corrected.games,
  };
  const secondRun = reconcileStoredEwc2026Week(correctedStored);
  assert.deepEqual(secondRun.diff, { week: [], games: [] });
  assert.deepEqual(secondRun.invalidSubmissionIntervals, []);
});

test('reconcileStoredEwc2026Week refuses non-2026 and ambiguously matched stored events', () => {
  const non2026 = storedParisWeek({ game: 'Valorant', event: 'EWC Valorant' });
  non2026.season = '2027';
  assert.throws(() => reconcileStoredEwc2026Week(non2026), /Only stored EWC 2026 weeks/);

  const ambiguous = storedParisWeek({ game: 'Valorant', event: 'EWC Valorant' });
  ambiguous.games[0] = { ...ambiguous.games[0], event: 'EWC Apex Legends' };
  assert.throws(() => reconcileStoredEwc2026Week(ambiguous), /cannot be uniquely matched/);
});

test('official schedule generation is independent of the process timezone', () => {
  const moduleUrl = pathToFileURL(resolve(rootDir, 'src/lib/ewcPredictions.js')).href;
  const source = `
    import { generateEwcWeekWindows } from ${JSON.stringify(moduleUrl)};
    const windows = generateEwcWeekWindows([{ game: 'Valorant', event: 'EWC Valorant' }, { game: 'Tekken 8', event: 'EWC Tekken 8' }]);
    process.stdout.write(JSON.stringify(windows));
  `;
  const run = (timeZone) =>
    JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
        encoding: 'utf8',
        cwd: rootDir,
        env: { ...process.env, TZ: timeZone },
      }),
    );

  assert.deepEqual(run('UTC'), run('America/Los_Angeles'));
});

test('reconciliation command dry-runs unchanged, applies safe rows atomically, and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewc-timezone-safe-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    const valorant = storedParisWeek({ game: 'Valorant', event: 'EWC Valorant' });
    const tekken = storedParisWeek({ game: 'Tekken 8', event: 'EWC Tekken 8' });
    seedFixture(dbPath, [
      {
        week: dbPayload(valorant),
        picks: [
          {
            userId: 'fixture-member-safe',
            gameKey: valorant.games[0].key,
            game: valorant.games[0].game,
            event: valorant.games[0].event,
            pick: 'Fixture Falcons',
            pickedAt: valorant.games[0].lockAt - oneHour - 1,
          },
        ],
      },
      { week: dbPayload(tekken), picks: [] },
    ]);
    const before = readWeeks(dbPath);

    const dryRun = runReconciliation(dbPath);
    assert.equal(dryRun.status, 0);
    assert.deepEqual(readWeeks(dbPath), before);
    assert.doesNotMatch(dryRun.output, /fixture-member-safe|Fixture Falcons/);

    const apply = runReconciliation(dbPath, ['--apply', '--confirm-ewc-2026-timezone']);
    assert.equal(apply.status, 0);
    const afterApply = readWeeks(dbPath);
    assert.equal(afterApply[0].start_at, valorant.start_at - oneHour);
    assert.equal(afterApply[1].start_at, tekken.start_at - oneHour);

    const secondApply = runReconciliation(dbPath, ['--apply', '--confirm-ewc-2026-timezone']);
    assert.equal(secondApply.status, 0);
    assert.match(secondApply.output, /Applied Riyadh timing reconciliation to 0 stored week\(s\)/);
    assert.deepEqual(readWeeks(dbPath), afterApply);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reconciliation command refuses affected picks without writing any week', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewc-timezone-affected-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    const safe = storedParisWeek({ game: 'Valorant', event: 'EWC Valorant' });
    const affected = storedParisWeek({ game: 'Tekken 8', event: 'EWC Tekken 8' });
    seedFixture(dbPath, [
      { week: dbPayload(safe), picks: [] },
      {
        week: dbPayload(affected),
        picks: [
          {
            userId: 'fixture-member-affected',
            gameKey: affected.games[0].key,
            game: affected.games[0].game,
            event: affected.games[0].event,
            pick: 'Fixture Secret',
            pickedAt: affected.games[0].lockAt - 1800,
          },
        ],
      },
    ]);
    const before = readWeeks(dbPath);

    const result = runReconciliation(dbPath, ['--apply', '--confirm-ewc-2026-timezone']);
    assert.equal(result.status, 1);
    assert.match(result.output, /STOP: apply refused/);
    assert.doesNotMatch(result.output, /fixture-member-affected|Fixture Secret/);
    assert.deepEqual(readWeeks(dbPath), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reconciliation command refuses scored rows without writing any week', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewc-timezone-scored-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    const scored = storedParisWeek({ game: 'Valorant', event: 'EWC Valorant' });
    seedFixture(dbPath, [{ week: dbPayload(scored), picks: [], status: 'scored' }]);
    const before = readWeeks(dbPath);

    const result = runReconciliation(dbPath, ['--apply', '--confirm-ewc-2026-timezone']);
    assert.equal(result.status, 1);
    assert.match(result.output, /STOP: apply refused/);
    assert.deepEqual(readWeeks(dbPath), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
