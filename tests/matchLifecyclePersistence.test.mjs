import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { closeDbClient, run } = await import('../src/db/client.js');
const { getMatch, toMatchRow, upsertMatch } = await import('../src/db/matches.js');
const {
  listActiveReminderMatchIdsForUser,
  upsertMatchReminder,
} = await import('../src/db/userMatchReminders.js');

test('persists lifecycle transitions atomically and rejects stale evidence', async (t) => {
  t.after(async () => {
    await closeDbClient();
  });

  const tournament = await run(
    `INSERT INTO tournaments (source, external_id, game, name, guild_id)
     VALUES ($1, $2, $3, $4, $5)`,
    ['liquipedia', 'game/Test', 'game', 'Lifecycle Test', 'guild-1'],
  );
  const tournamentId = Number(tournament.lastInsertRowid);
  const firstStart = 1_800_000_000;
  const rescheduledStart = firstStart + 3600;
  const scheduled = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'scheduled',
    scheduled_at: firstStart,
  });
  await upsertMatchReminder({ discordUserId: 'user-1', matchId: scheduled.id });

  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'running',
    score_a: 1,
    score_b: 0,
    scheduled_at: firstStart,
  });
  const unknown = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'provider-mystery',
    score_a: 9,
    score_b: 9,
    scheduled_at: rescheduledStart,
  });
  assert.equal(unknown.status, 'running');
  assert.equal(unknown.score_a, 1);
  assert.equal(unknown.score_b, 0);
  assert.equal(unknown.scheduled_at, firstStart);

  const postponed = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'postponed',
    winner_side: 'team1',
    result_reason: 'normal',
    scheduled_at: firstStart,
  });
  assert.equal(postponed.status, 'postponed');
  assert.equal(postponed.winner_side, null);
  assert.equal(postponed.result_reason, 'postponed');
  assert.deepEqual(await listActiveReminderMatchIdsForUser('user-1'), [scheduled.id]);

  const unchangedSchedule = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'scheduled',
    scheduled_at: firstStart,
  });
  assert.equal(unchangedSchedule.status, 'postponed');

  const rescheduled = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'scheduled',
    scheduled_at: rescheduledStart,
  });
  assert.equal(rescheduled.status, 'scheduled');
  assert.equal(rescheduled.scheduled_at, rescheduledStart);

  const cancelled = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'cancelled',
    scheduled_at: rescheduledStart,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.result_reason, 'cancelled');
  assert.deepEqual(await listActiveReminderMatchIdsForUser('user-1'), []);

  const stale = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:lifecycle',
    team_a: 'Alpha',
    team_b: 'Bravo',
    status: 'running',
    score_a: 2,
    score_b: 0,
    scheduled_at: rescheduledStart,
  });
  assert.equal(stale.status, 'cancelled');
  assert.equal(stale.winner_side, null);
  assert.equal(stale.result_reason, 'cancelled');

  await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:corrected-final',
    team_a: 'Team Vision',
    team_b: 'Aurora Gaming',
    status: 'finished',
    score_a: 2,
    score_b: 0,
    scheduled_at: rescheduledStart,
  });
  const corrected = await upsertMatch({
    tournament_id: tournamentId,
    source: 'liquipedia',
    external_id: 'match:corrected-final',
    team_a: 'Team Vision',
    team_b: 'Aurora Gaming',
    status: 'finished',
    score_a: 3,
    score_b: 0,
    scheduled_at: rescheduledStart,
  });
  assert.equal(corrected.score_a, 3, 'a corrected authoritative final replaces the stale score');
  assert.equal(corrected.score_b, 0);
  assert.equal(corrected.winner_side, 'team1');
});

test('toMatchRow preserves a trusted scoreless winner', () => {
  const row = toMatchRow(
    {
      source: 'liquipedia',
      externalId: 'match:walkover',
      teamA: 'Alpha',
      teamB: 'Bravo',
      status: 'finished',
      winner: 'Bravo',
      resultReason: 'walkover',
    },
    12,
  );
  assert.equal(row.winner_side, 'team2');
  assert.equal(row.result_reason, 'walkover');
  assert.equal(row.score_a, null);
  assert.equal(row.score_b, null);
});

test('SQLite lifecycle migration preserves match ids and dependent rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ecb-match-lifecycle-'));
  const databasePath = join(directory, 'old.sqlite');
  const oldDb = new Database(databasePath);
  try {
    oldDb.pragma('foreign_keys = ON');
    oldDb.exec(`
      CREATE TABLE tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL CHECK (source IN ('pandascore','startgg','liquipedia')),
        external_id TEXT NOT NULL,
        game TEXT,
        name TEXT,
        url TEXT,
        guild_id TEXT NOT NULL,
        added_by TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source, external_id, guild_id)
      );
      CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        name TEXT,
        team_a TEXT,
        team_b TEXT,
        score_a INTEGER DEFAULT 0,
        score_b INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled','running','finished')),
        scheduled_at INTEGER,
        last_polled_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source, external_id)
      );
      CREATE TABLE match_details (
        match_id INTEGER NOT NULL PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
        source_page TEXT NOT NULL,
        game TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE user_match_reminders (
        discord_user_id TEXT NOT NULL,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        canceled_at TEXT,
        PRIMARY KEY (discord_user_id, match_id)
      );
      INSERT INTO tournaments (id, source, external_id, game, name, guild_id)
        VALUES (7, 'liquipedia', 'game/Old', 'game', 'Old Tournament', 'guild-1');
      INSERT INTO matches
        (id, tournament_id, source, external_id, team_a, team_b, score_a, score_b, status)
        VALUES (41, 7, 'liquipedia', 'old:finished', 'Alpha', 'Bravo', 2, 1, 'finished');
      INSERT INTO match_details
        (match_id, source_page, game, payload_json, fetched_at, updated_at)
        VALUES (41, 'game/Old', 'game', '{}', '2026-01-01', '2026-01-01');
      INSERT INTO user_match_reminders
        (discord_user_id, match_id, created_at)
        VALUES ('user-1', 41, '2026-01-01');
    `);
  } finally {
    oldDb.close();
  }

  try {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "await import('./src/db/index.js'); const { closeDb } = await import('./src/db/connection.js'); closeDb();",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DB_PATH: databasePath,
          DATABASE_URL: '',
          DB_DRIVER: 'sqlite',
        },
        stdio: 'pipe',
      },
    );

    const migrated = new Database(databasePath, { readonly: true });
    try {
      const columns = migrated.prepare('PRAGMA table_info(matches)').all().map((column) => column.name);
      assert.ok(columns.includes('winner_side'));
      assert.ok(columns.includes('result_reason'));
      assert.match(
        migrated.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='matches'").get().sql,
        /postponed[\s\S]*cancelled/i,
      );
      assert.deepEqual(
        migrated
          .prepare('SELECT id, status, winner_side, result_reason FROM matches WHERE id = 41')
          .get(),
        {
          id: 41,
          status: 'finished',
          winner_side: 'team1',
          result_reason: 'normal',
        },
      );
      assert.equal(migrated.prepare('SELECT match_id FROM match_details').get().match_id, 41);
      assert.equal(migrated.prepare('SELECT match_id FROM user_match_reminders').get().match_id, 41);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
