import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STATUSES = ['scheduled', 'running', 'finished', 'postponed', 'cancelled'];
const WINNERS = ['team1', 'team2', 'draw'];
const REASONS = ['normal', 'walkover', 'forfeit', 'cancelled', 'postponed', 'unknown'];

function compact(sql) {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

function quotedValues(values) {
  return values.map((value) => `'${value}'`).join(',');
}

test('SQLite and PostgreSQL match lifecycle schemas keep the same bounded domain', async () => {
  const [sqliteSource, postgresSchema, postgresMigration] = await Promise.all([
    readFile(new URL('../src/db/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/postgres/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/postgres/migrations/0002-match-lifecycle.sql', import.meta.url), 'utf8'),
  ]);
  const sqlite = compact(sqliteSource);
  const postgres = compact(postgresSchema);
  const migration = compact(postgresMigration);

  for (const schema of [sqlite, postgres]) {
    assert.match(schema, new RegExp(`status in \\(${quotedValues(STATUSES)}\\)`));
    assert.match(schema, new RegExp(`winner_side[^;]{0,120}winner_side in \\(${quotedValues(WINNERS)}\\)`));
    assert.match(schema, new RegExp(`result_reason in \\(${quotedValues(REASONS)}\\)`));
    assert.match(schema, /score_a integer/);
    assert.match(schema, /score_b integer/);
    assert.doesNotMatch(schema, /score_[ab] integer not null/);
    assert.match(schema, /status = 'postponed' and winner_side is null and result_reason = 'postponed'/);
    assert.match(schema, /status = 'cancelled' and winner_side is null and result_reason = 'cancelled'/);
    assert.match(schema, /status = 'finished' and result_reason in \('normal','walkover','forfeit','unknown'\)/);
  }

  assert.match(migration, /alter column score_a drop default/);
  assert.match(migration, /alter column score_b drop default/);
  assert.match(migration, /add constraint matches_lifecycle_outcome_check/);
});
