import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(tmpdir(), 'notification-schema-'));
const dbPath = join(dir, 'legacy.sqlite');
const legacy = new Database(dbPath);
legacy.exec(`
  CREATE TABLE user_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    entity_label TEXT NOT NULL DEFAULT '',
    entity_ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (discord_user_id, entity_type, entity_key)
  );
  CREATE TABLE user_notification_prefs (
    discord_user_id TEXT PRIMARY KEY,
    dm_enabled INTEGER NOT NULL DEFAULT 1,
    notify_match_start INTEGER NOT NULL DEFAULT 1,
    notify_match_result INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    match_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NOT NULL,
    read_at TEXT,
    dm_status TEXT NOT NULL DEFAULT 'skipped',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (discord_user_id, dedupe_key)
  );
`);
legacy.prepare(`INSERT INTO user_notifications
  (discord_user_id, type, title, dedupe_key, dm_status) VALUES (?, ?, ?, ?, ?)`)
  .run('legacy-user', 'match_start', 'Legacy pending', 'legacy:pending', 'pending');
legacy.prepare(`INSERT INTO user_notifications
  (discord_user_id, type, title, dedupe_key, dm_status) VALUES (?, ?, ?, ?, ?)`)
  .run('legacy-user', 'match_result', 'Legacy sent', 'legacy:sent', 'sent');
legacy.close();

process.env.DB_PATH = dbPath;
const { db, closeDb } = await import('../src/db/index.js');
const { listPendingDmNotifications } = await import('../src/db/userNotifications.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('additive SQLite migration repairs legacy pending rows without changing historical timestamps', async () => {
  const columns = new Set(db.prepare('PRAGMA table_info(user_notifications)').all().map((column) => column.name));
  assert.ok(columns.has('dm_delivery_mode'));
  assert.ok(columns.has('dm_not_before'));
  const followColumns = new Set(db.prepare('PRAGMA table_info(user_follows)').all().map((column) => column.name));
  assert.ok(followColumns.has('notify_match_start'));
  assert.ok(followColumns.has('notify_match_result'));
  assert.ok(db.prepare('PRAGMA index_list(user_notifications)').all().some((index) => index.name === 'idx_user_notifications_dm_due'));

  const pending = db.prepare(`SELECT dm_delivery_mode, dm_not_before FROM user_notifications WHERE dedupe_key = 'legacy:pending'`).get();
  assert.deepEqual(pending, { dm_delivery_mode: 'instant', dm_not_before: 0 });
  const historical = db.prepare(`SELECT dm_delivery_mode, dm_not_before FROM user_notifications WHERE dedupe_key = 'legacy:sent'`).get();
  assert.deepEqual(historical, { dm_delivery_mode: 'instant', dm_not_before: null });
  const due = await listPendingDmNotifications(10, { nowSec: 0 });
  assert.equal(due.length, 1);
  assert.equal(due[0].dedupe_key, 'legacy:pending');
});

test('Postgres schema has matching additive columns, repair, and due index', () => {
  const schema = readFileSync(new URL('../scripts/postgres/schema.sql', import.meta.url), 'utf8');
  for (const column of ['notify_match_start', 'notify_match_result', 'dm_delivery_mode', 'dm_not_before']) {
    assert.match(schema, new RegExp(column));
  }
  assert.match(schema, /UPDATE user_notifications SET dm_not_before = 0 WHERE dm_status = 'pending' AND dm_not_before IS NULL/);
  assert.match(schema, /idx_user_notifications_dm_due ON user_notifications\(dm_status, dm_not_before, id\)/);
});
