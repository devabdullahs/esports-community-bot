import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { appTables, identityColumns } from '../scripts/migrate-sqlite-to-postgres.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'scripts/postgres/schema.sql'), 'utf8');

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
