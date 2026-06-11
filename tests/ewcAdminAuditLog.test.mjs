import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-audit-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb, db } = await import('../src/db/index.js');
const { recordAdminAudit, listAdminAuditLog } = await import('../src/db/ewcAdminAuditLog.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('records two entries and lists them newest-first with hydrated details', () => {
  recordAdminAudit({
    actorId: '111111111111111111',
    actorName: 'Alice',
    action: 'game.create',
    target: 'street-fighter',
    details: { note: 'first' },
  });

  recordAdminAudit({
    actorId: '222222222222222222',
    actorName: 'Bob',
    action: 'news.delete',
    target: '42',
    details: null,
  });

  const entries = listAdminAuditLog();

  assert.equal(entries.length, 2);

  // Newest-first: Bob's entry (inserted second) should be first.
  // SQLite datetime('now') has 1-second resolution; we rely on id DESC as a tiebreaker.
  // Use a stable assertion: both actions are present, newest id is first.
  assert.ok(entries[0].id > entries[1].id, 'entries should be newest-first by id');

  const bobEntry = entries[0];
  assert.equal(bobEntry.actorId, '222222222222222222');
  assert.equal(bobEntry.actorName, 'Bob');
  assert.equal(bobEntry.action, 'news.delete');
  assert.equal(bobEntry.target, '42');
  assert.equal(bobEntry.details, null);

  const aliceEntry = entries[1];
  assert.equal(aliceEntry.actorId, '111111111111111111');
  assert.equal(aliceEntry.actorName, 'Alice');
  assert.equal(aliceEntry.action, 'game.create');
  assert.equal(aliceEntry.target, 'street-fighter');
  assert.deepEqual(aliceEntry.details, { note: 'first' });
});

test('malformed details row hydrates to null without throwing', () => {
  // Insert a row with invalid JSON directly via db to simulate corruption.
  db.prepare(
    `INSERT INTO ewc_admin_audit_log (actor_id, actor_name, action, target, details)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('333333333333333333', 'Charlie', 'game.update', 'bad-game', 'not-valid-json{{{');

  // listAdminAuditLog must not throw.
  const entries = listAdminAuditLog();
  const charlie = entries.find((e) => e.actorId === '333333333333333333');
  assert.ok(charlie, 'charlie entry should be present');
  assert.equal(charlie.details, null, 'malformed JSON should hydrate to null');
});

test('limit and offset are respected', () => {
  // We now have at least 3 entries; offset 1 should skip the newest.
  const all = listAdminAuditLog();
  const paged = listAdminAuditLog(1, 1);
  assert.equal(paged.length, 1);
  assert.equal(paged[0].id, all[1].id, 'offset 1 should return the second entry');
});
