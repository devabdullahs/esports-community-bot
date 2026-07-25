import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function compact(sql) {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

test('SQLite and PostgreSQL expose the same tournament operation and lifecycle domains', async () => {
  const [sqliteSource, postgresSchema, migration] = await Promise.all([
    readFile(new URL('../src/db/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/postgres/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/postgres/migrations/0003-tournament-operations.sql', import.meta.url), 'utf8'),
  ]);
  const schemas = [compact(sqliteSource), compact(postgresSchema), compact(migration)];
  for (const schema of schemas) {
    assert.match(schema, /lifecycle_generation (?:integer|bigint) not null default 0/);
    assert.match(schema, /create table if not exists tournament_data_health/);
    assert.match(schema, /data_kind text not null check \(data_kind in \('schedule','standings'\)\)/);
    assert.match(schema, /create table if not exists tournament_operations/);
    assert.match(
      schema,
      /operation text not null check \(operation in \( 'validate_and_activate','sync_schedule','sync_standings', 'archive','deactivate','reactivate' \)\)/,
    );
    assert.match(schema, /status text not null default 'queued' check \(status in \('queued','running','succeeded','failed'\)\)/);
    assert.match(schema, /idempotency_key text not null unique/);
    assert.match(schema, /attempts integer not null default 0 check \(attempts >= 0 and attempts <= 20\)/);
  }
});
