import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import test from 'node:test';

import { stableEwcGameKey } from '../src/lib/ewcPredictions.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reconciliationScript = resolve(rootDir, 'scripts/rekey-ewc-prediction-games.mjs');
const predictionDbModule = pathToFileURL(resolve(rootDir, 'src/db/ewcPredictions.js')).href;
const dbClientModule = pathToFileURL(resolve(rootDir, 'src/db/client.js')).href;
const guildId = 'game-key-script-guild';
const memberId = '200000000000009999';

const legacyValorant = {
  key: 'valorant-1',
  game: 'Valorant',
  gameWiki: 'valorant',
  event: 'EWC Valorant',
  eventUrl: 'https://liquipedia.net/valorant/Esports_World_Cup/2026',
  startAt: 1_800_000_000,
  endAt: 1_800_086_400,
  lockAt: 1_799_996_400,
};

function seedFixture(dbPath, { games = [legacyValorant], scored = false, withReferences = true } = {}) {
  const source = `
    const {
      claimEwcPredictionReminder,
      setEwcWeekResults,
      setEwcWeekStatus,
      upsertEwcWeek,
      upsertWeeklyGamePick,
    } = await import(${JSON.stringify(predictionDbModule)});
    const { closeDbClient } = await import(${JSON.stringify(dbClientModule)});
    const games = ${JSON.stringify(games)};
    const week = await upsertEwcWeek({
      guildId: ${JSON.stringify(guildId)},
      season: '2026',
      weekKey: 'week-script',
      label: 'Week script',
      games,
      createdBy: 'fixture',
    });
    if (${JSON.stringify(withReferences)}) {
      await upsertWeeklyGamePick({
        guildId: ${JSON.stringify(guildId)},
        weekId: week.id,
        userId: ${JSON.stringify(memberId)},
        gameKey: games[0].key,
        game: games[0].game,
        event: games[0].event,
        pick: 'Fixture Club',
        pickedAt: games[0].lockAt - 10,
      });
      await setEwcWeekResults(week.id, [{ gameKey: games[0].key, winner: 'Fixture Club' }]);
      await claimEwcPredictionReminder({
        guildId: ${JSON.stringify(guildId)},
        weekId: week.id,
        gameKey: games[0].key,
        kind: 'pre_lock',
        nowSec: 100,
      });
    }
    if (${JSON.stringify(scored)}) await setEwcWeekStatus(week.id, 'scored');
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

function readState(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const week = db
      .prepare('SELECT games_json, results_json, status FROM ewc_prediction_weeks WHERE week_key = ?')
      .get('week-script');
    const prediction = db
      .prepare('SELECT picks_json, score, details_json FROM ewc_weekly_predictions WHERE user_id = ?')
      .get(memberId);
    const reminders = db
      .prepare('SELECT game_key, kind, sent_at, claim_token, claim_expires_at, attempts FROM ewc_prediction_reminders ORDER BY game_key, kind')
      .all();
    return { week, prediction, reminders };
  } finally {
    db.close();
  }
}

test('game-key command is dry-run first, applies atomically, and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewc-game-key-safe-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    seedFixture(dbPath);
    const before = readState(dbPath);

    const dryRun = runReconciliation(dbPath);
    assert.equal(dryRun.status, 0);
    assert.match(dryRun.output, /Game keys to rekey: 1/);
    assert.doesNotMatch(dryRun.output, new RegExp(`${memberId}|Fixture Club`));
    assert.deepEqual(readState(dbPath), before);

    const missingConfirmation = runReconciliation(dbPath, ['--apply']);
    assert.equal(missingConfirmation.status, 1);
    assert.deepEqual(readState(dbPath), before);

    const applied = runReconciliation(dbPath, ['--apply', '--confirm-ewc-game-keys']);
    assert.equal(applied.status, 0);
    assert.match(applied.output, /Applied stable EWC game keys to 1 stored week/);
    const after = readState(dbPath);
    const stableKey = stableEwcGameKey(legacyValorant);
    assert.equal(JSON.parse(after.week.games_json)[0].key, stableKey);
    assert.equal(JSON.parse(after.week.results_json)[0].gameKey, stableKey);
    assert.equal(JSON.parse(after.prediction.picks_json)[0].gameKey, stableKey);
    assert.equal(after.reminders[0].game_key, stableKey);

    const repeated = runReconciliation(dbPath, ['--apply', '--confirm-ewc-game-keys']);
    assert.equal(repeated.status, 0);
    assert.match(repeated.output, /Applied stable EWC game keys to 0 stored week/);
    assert.deepEqual(readState(dbPath), after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('game-key command refuses ambiguous legacy identities without writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewc-game-key-ambiguous-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    seedFixture(dbPath, {
      games: [legacyValorant, { ...legacyValorant, key: 'valorant-2' }],
      withReferences: false,
    });
    const before = readState(dbPath);
    const result = runReconciliation(dbPath, ['--apply', '--confirm-ewc-game-keys']);
    assert.equal(result.status, 1);
    assert.match(result.output, /STOP: apply refused/);
    assert.deepEqual(readState(dbPath), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('game-key command refuses a scored round that still needs rekeying', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewc-game-key-scored-'));
  const dbPath = join(dir, 'bot.sqlite');
  try {
    seedFixture(dbPath, { scored: true });
    const before = readState(dbPath);
    const result = runReconciliation(dbPath, ['--apply', '--confirm-ewc-game-keys']);
    assert.equal(result.status, 1);
    assert.match(result.output, /STOP: apply refused/);
    assert.deepEqual(readState(dbPath), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
