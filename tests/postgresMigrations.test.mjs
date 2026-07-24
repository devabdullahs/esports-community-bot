import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

import { buildPostgresSchema } from '../scripts/build-postgres-schema.mjs';
import { validatePostgresTestConfig } from '../scripts/run-postgres-tests.mjs';
import {
  listPostgresMigrations,
  resolvePgSslConfig,
  runPostgresMigrations,
} from '../src/db/postgresMigrations.js';

const postgresEnabled =
  process.env.DB_DRIVER === 'postgres' &&
  process.env.ALLOW_POSTGRES_TEST_RESET === '1' &&
  Boolean(process.env.DATABASE_URL);

function postgresOptions() {
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: resolvePgSslConfig(process.env.PGSSLMODE, { rootCertPath: process.env.PGSSLROOTCERT }),
  };
}

async function resetPublicSchema() {
  const client = new pg.Client(postgresOptions());
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

async function queryOne(sql, params = []) {
  const client = new pg.Client(postgresOptions());
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
}

async function withTemporaryMigrations(files, fn) {
  const directory = await mkdtemp(join(tmpdir(), 'ecb-postgres-migrations-'));
  try {
    await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(join(directory, name), sql, 'utf8')));
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runWithMigrations(migrationsDir) {
  return runPostgresMigrations({ ...postgresOptions(), migrationsDir });
}

test('PostgreSQL migration snapshot is generated and excludes Better Auth tables', async () => {
  await buildPostgresSchema({ check: true });
  const baseline = await readFile('scripts/postgres/migrations/0001-baseline.sql', 'utf8');
  assert.doesNotMatch(baseline, /CREATE TABLE IF NOT EXISTS ["']?(?:user|session|account|verification)["']?\s*\(/i);
});

test('PostgreSQL migration filename validation rejects gaps and duplicates', async () => {
  await withTemporaryMigrations(
    {
      '0001-first.sql': 'SELECT 1;\n',
      '0003-third.sql': 'SELECT 3;\n',
    },
    async (directory) => {
      assert.throws(() => listPostgresMigrations(directory), /must be contiguous/);
    },
  );

  await withTemporaryMigrations(
    {
      '0001-first.sql': 'SELECT 1;\n',
      '0001-duplicate.sql': 'SELECT 1;\n',
    },
    async (directory) => {
      assert.throws(() => listPostgresMigrations(directory), /Duplicate PostgreSQL migration version/);
    },
  );
});

test('PostgreSQL migration checksums and snapshots are independent of checkout line endings', async () => {
  await withTemporaryMigrations(
    {
      '0001-line-endings.sql': 'CREATE TABLE line_ending_probe (\r\n  id INTEGER PRIMARY KEY\r\n);\r\n',
    },
    async (directory) => {
      const windows = listPostgresMigrations(directory)[0];
      await writeFile(
        join(directory, '0001-line-endings.sql'),
        'CREATE TABLE line_ending_probe (\n  id INTEGER PRIMARY KEY\n);\n',
        'utf8',
      );
      const unix = listPostgresMigrations(directory)[0];

      assert.equal(windows.checksum, unix.checksum);
      assert.equal(windows.sql, unix.sql);
    },
  );
});

test(
  'PostgreSQL migration applies a fresh database and records its checksum',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    const result = await runPostgresMigrations(postgresOptions());
    const expected = listPostgresMigrations().map(({ version, checksum }) => ({ version, checksum }));

    assert.deepEqual(result.applied, expected.map(({ version }) => version));
    const ledger = await queryOne('SELECT version, checksum FROM app_schema_migrations ORDER BY version ASC');
    assert.deepEqual(ledger, expected[0]);
    assert.equal((await queryOne("SELECT to_regclass('public.tournaments') AS table_name")).table_name, 'tournaments');
  },
);

test(
  'PostgreSQL migration baselines an existing current schema without a ledger',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    const baseline = await readFile('scripts/postgres/migrations/0001-baseline.sql', 'utf8');
    const client = new pg.Client(postgresOptions());
    await client.connect();
    try {
      await client.query(baseline);
    } finally {
      await client.end();
    }

    const result = await runPostgresMigrations(postgresOptions());
    assert.deepEqual(result.applied, ['0001']);
    assert.equal(Number((await queryOne('SELECT COUNT(*)::BIGINT AS count FROM app_schema_migrations')).count), 1);
  },
);

test(
  'PostgreSQL migration second run is a ledger no-op',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    await runPostgresMigrations(postgresOptions());
    const second = await runPostgresMigrations(postgresOptions());

    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.alreadyApplied, ['0001']);
  },
);

test(
  'PostgreSQL migration advisory lock serializes concurrent starters',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    await withTemporaryMigrations(
      {
        '0001-slow.sql': 'SELECT pg_sleep(0.15);\nCREATE TABLE migration_lock_probe (id INTEGER PRIMARY KEY);\n',
      },
      async (directory) => {
        const [first, second] = await Promise.all([runWithMigrations(directory), runWithMigrations(directory)]);
        assert.deepEqual([first.applied, second.applied].flat(), ['0001']);
        assert.deepEqual([first.alreadyApplied, second.alreadyApplied].flat(), ['0001']);
        assert.equal(Number((await queryOne('SELECT COUNT(*)::BIGINT AS count FROM app_schema_migrations')).count), 1);
      },
    );
  },
);

test(
  'PostgreSQL migration failure rolls back DDL and ledger row',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    await withTemporaryMigrations(
      {
        '0001-failing.sql': 'CREATE TABLE migration_rollback_probe (id INTEGER PRIMARY KEY);\nSELECT 1 / 0;\n',
      },
      async (directory) => {
        await assert.rejects(runWithMigrations(directory), /division by zero/);
      },
    );

    assert.equal((await queryOne("SELECT to_regclass('public.migration_rollback_probe') AS table_name")).table_name, null);
    assert.equal(Number((await queryOne('SELECT COUNT(*)::BIGINT AS count FROM app_schema_migrations')).count), 0);
  },
);

test(
  'PostgreSQL migration rejects checksum drift',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    await withTemporaryMigrations(
      {
        '0001-checksum.sql': 'CREATE TABLE migration_checksum_probe (id INTEGER PRIMARY KEY);\n',
      },
      async (directory) => {
        await runWithMigrations(directory);
        await writeFile(
          join(directory, '0001-checksum.sql'),
          'CREATE TABLE migration_checksum_probe (id INTEGER PRIMARY KEY);\nSELECT 1;\n',
          'utf8',
        );
        await assert.rejects(runWithMigrations(directory), /checksum mismatch/);
      },
    );
  },
);

test(
  'PostgreSQL migration rejects an applied version whose source file is missing',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    await withTemporaryMigrations(
      {
        '0001-first.sql': 'CREATE TABLE migration_missing_source_probe (id INTEGER PRIMARY KEY);\n',
        '0002-second.sql': 'ALTER TABLE migration_missing_source_probe ADD COLUMN label TEXT;\n',
      },
      async (directory) => {
        await runWithMigrations(directory);
        await rm(join(directory, '0002-second.sql'));
        await assert.rejects(runWithMigrations(directory), /missing source version 0002/);
      },
    );
  },
);

test(
  'PostgreSQL migration upgrade applies only newly added versions',
  { skip: postgresEnabled ? false : 'run through npm run test:postgres', concurrency: false },
  async () => {
    validatePostgresTestConfig();
    await resetPublicSchema();
    await withTemporaryMigrations(
      {
        '0001-first.sql': 'CREATE TABLE migration_upgrade_probe (id INTEGER PRIMARY KEY);\n',
      },
      async (directory) => {
        const first = await runWithMigrations(directory);
        assert.deepEqual(first.applied, ['0001']);

        await writeFile(
          join(directory, '0002-second.sql'),
          'ALTER TABLE migration_upgrade_probe ADD COLUMN label TEXT;\n',
          'utf8',
        );
        const second = await runWithMigrations(directory);

        assert.deepEqual(second.applied, ['0002']);
        assert.deepEqual(second.alreadyApplied, ['0001']);
        const columnCount = await queryOne(
          `SELECT COUNT(*)::BIGINT AS count
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'migration_upgrade_probe'
             AND column_name = 'label'`,
        );
        assert.equal(Number(columnCount.count), 1);
        assert.equal(Number((await queryOne('SELECT COUNT(*)::BIGINT AS count FROM app_schema_migrations')).count), 2);
      },
    );
  },
);
