import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  appTables,
  buildColumnMapping,
  identityColumns,
  parseArgs,
} from '../scripts/migrate-sqlite-to-postgres.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'scripts/postgres/schema.sql'), 'utf8');
const sqliteSchema = readFileSync(join(root, 'src/db/index.js'), 'utf8');

function schemaTables() {
  return [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
}

// Tables with a Postgres `GENERATED ... AS IDENTITY` column, whose sequence must
// be reset after the copy. Derived from schema.sql the same way the script's map
// should be.
function schemaIdentityTables() {
  const tables = [];
  let current = null;
  for (const line of schema.split('\n')) {
    const create = line.match(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/i);
    if (create) current = create[1];
    if (current && /GENERATED (BY DEFAULT|ALWAYS) AS IDENTITY/i.test(line)) {
      if (!tables.includes(current)) tables.push(current);
    }
  }
  return tables;
}

test('every schema.sql table is in the migration copy list (no silently-dropped table)', () => {
  const missing = schemaTables().filter((t) => !appTables.includes(t));
  assert.deepEqual(missing, [], `add these to appTables in migrate-sqlite-to-postgres.mjs: ${missing.join(', ')}`);
});

test('migration copy list has no table that is absent from schema.sql', () => {
  const known = new Set(schemaTables());
  const stale = appTables.filter((t) => !known.has(t));
  assert.deepEqual(stale, [], `remove/rename these stale appTables entries: ${stale.join(', ')}`);
});

test('every identity table has a sequence-reset entry', () => {
  const mapped = new Set(identityColumns.keys());
  const missing = schemaIdentityTables().filter((t) => !mapped.has(t));
  assert.deepEqual(missing, [], `add these to identityColumns: ${missing.join(', ')}`);
});

test('comment targets stay aligned across SQLite, Postgres, and the copy migration', () => {
  for (const source of [sqliteSchema, schema]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS post_comments[\s\S]*?target_type/i);
    assert.match(source, /CREATE TABLE IF NOT EXISTS post_comments[\s\S]*?target_id/i);
    assert.match(source, /target_type IN \('news','match'\)/i);
  }
  assert.match(schema, /ALTER TABLE post_comments ALTER COLUMN post_id DROP NOT NULL/i);
  assert.match(schema, /post_comments_target_shape_check/i);
  assert.match(schema, /delete_match_comments/i);
  assert.match(
    readFileSync(join(root, 'scripts/migrate-sqlite-to-postgres.mjs'), 'utf8'),
    /legacy comments are news comments/i,
  );
});

test('migration column mapping rejects every unlisted schema difference', () => {
  assert.throws(
    () =>
      buildColumnMapping({
        table: 'teams',
        sourceColumns: ['id', 'name', 'unexpected_source'],
        targetColumns: ['id', 'name'],
      }),
    /teams.*source-only.*unexpected_source/i,
  );
  assert.throws(
    () =>
      buildColumnMapping({
        table: 'teams',
        sourceColumns: ['id', 'name'],
        targetColumns: ['id', 'name', 'unexpected_target'],
      }),
    /teams.*target-only.*unexpected_target/i,
  );
});

test('legacy post comments have an explicit target transformation', () => {
  const mapping = buildColumnMapping({
    table: 'post_comments',
    sourceColumns: ['id', 'post_id', 'body'],
    targetColumns: ['id', 'post_id', 'target_type', 'target_id', 'body'],
  });
  const targetType = mapping.columns.find((column) => column.targetColumn === 'target_type');
  const targetId = mapping.columns.find((column) => column.targetColumn === 'target_id');
  assert.equal(targetType.derive({ post_id: 42 }), 'news');
  assert.equal(targetId.derive({ post_id: 42 }), 42);
});

test('database URL is accepted only through the environment', () => {
  assert.throws(
    () => parseArgs(['--database-url', 'postgresql://user:secret@example.invalid/db']),
    /Use DATABASE_URL/,
  );
  assert.equal(parseArgs(['--preflight-target', '--sqlite', 'fixture.sqlite']).preflightTarget, true);
});
