import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultMigrationsDir = resolve(rootDir, 'scripts/postgres/migrations');
const migrationFilePattern = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.sql$/;
const advisoryLockKey = '731330001';

export const POSTGRES_MIGRATIONS_DIR = defaultMigrationsDir;
export const POSTGRES_MIGRATION_ADVISORY_LOCK_KEY = advisoryLockKey;

export function resolvePgSslConfig(mode, { rootCertPath } = {}) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === 'disable') return false;
  if (normalized === 'require' || normalized === 'no-verify') return { rejectUnauthorized: false };
  if (normalized === 'verify-ca' || normalized === 'verify-full') {
    const ssl = { rejectUnauthorized: true };
    if (rootCertPath) ssl.ca = readFileSync(rootCertPath, 'utf8');
    return ssl;
  }
  return undefined;
}

export function postgresMigrationsRequested(env = process.env) {
  const driver = String(env.DB_DRIVER || '').toLowerCase();
  return driver === 'postgres' || (!driver && Boolean(env.DATABASE_URL));
}

function normalizeSqlLineEndings(sql) {
  return String(sql).replace(/\r\n?/g, '\n');
}

export function listPostgresMigrations(migrationsDir = defaultMigrationsDir) {
  if (!existsSync(migrationsDir)) {
    throw new Error('PostgreSQL migration directory is missing: ' + migrationsDir);
  }

  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = migrationFilePattern.exec(entry.name);
      if (!match) {
        throw new Error('Invalid PostgreSQL migration filename: ' + entry.name);
      }

      const sql = normalizeSqlLineEndings(readFileSync(resolve(migrationsDir, entry.name), 'utf8'));
      return {
        filename: entry.name,
        version: match[1],
        number: Number(match[1]),
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
        sql,
      };
    })
    .sort((left, right) => left.number - right.number || left.filename.localeCompare(right.filename));

  if (!migrations.length) {
    throw new Error('No PostgreSQL migrations found in ' + migrationsDir);
  }

  const seenVersions = new Set();
  for (const migration of migrations) {
    if (seenVersions.has(migration.version)) {
      throw new Error('Duplicate PostgreSQL migration version: ' + migration.version);
    }
    seenVersions.add(migration.version);
  }

  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const expectedNumber = index + 1;
    if (migration.number !== expectedNumber) {
      throw new Error(
        'PostgreSQL migration versions must be contiguous from 0001; expected ' +
          String(expectedNumber).padStart(4, '0') +
          ' but found ' +
          migration.version,
      );
    }
  }

  return migrations;
}

export function buildPostgresSchemaSnapshot(migrations = listPostgresMigrations()) {
  const header = [
    '-- GENERATED FILE. DO NOT EDIT.',
    '-- Source: scripts/postgres/migrations/*.sql',
    '-- Regenerate with: npm run db:pg:schema:generate',
    '',
  ];

  const sections = migrations.map(({ filename, sql }) => {
    const body = sql.endsWith('\n') ? sql : sql + '\n';
    return '-- BEGIN MIGRATION ' + filename + '\n' + body + '-- END MIGRATION ' + filename + '\n';
  });

  return header.join('\n') + sections.join('\n');
}

export function sanitizePostgresError(error, connectionString = '') {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]');
  message = message.replace(/password\s*=\s*[^\s,;]+/gi, 'password=[redacted]');
  if (connectionString) {
    message = message.split(connectionString).join('[redacted-url]');
    try {
      const password = new URL(connectionString).password;
      if (password) message = message.split(decodeURIComponent(password)).join('[redacted]');
    } catch {
      // Connection strings are validated by node-postgres when it connects.
    }
  }
  return message.replace(/[\r\n]+/g, ' ').trim();
}

async function applyPendingMigration(client, migration) {
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO app_schema_migrations (version, checksum, applied_at) VALUES ($1, $2, NOW())',
      [migration.version, migration.checksum],
    );
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  }
}

export async function applyPostgresMigrations(client, { migrationsDir = defaultMigrationsDir, onStatus } = {}) {
  let lockHeld = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [advisoryLockKey]);
    lockHeld = true;
    await client.query(
      [
        'CREATE TABLE IF NOT EXISTS app_schema_migrations (',
        '  version TEXT PRIMARY KEY,',
        '  checksum TEXT NOT NULL,',
        '  applied_at TIMESTAMPTZ NOT NULL',
        ')',
      ].join('\n'),
    );

    const migrations = listPostgresMigrations(migrationsDir);
    const appliedRows = await client.query('SELECT version, checksum FROM app_schema_migrations ORDER BY version ASC');
    const appliedByVersion = new Map(appliedRows.rows.map((row) => [row.version, row.checksum]));
    const knownVersions = new Set(migrations.map((migration) => migration.version));

    for (const version of appliedByVersion.keys()) {
      if (!knownVersions.has(version)) {
        throw new Error('PostgreSQL migration ledger contains missing source version ' + version);
      }
    }

    const applied = [];
    const alreadyApplied = [];
    for (const migration of migrations) {
      const recordedChecksum = appliedByVersion.get(migration.version);
      if (recordedChecksum) {
        if (recordedChecksum !== migration.checksum) {
          throw new Error('PostgreSQL migration checksum mismatch for version ' + migration.version);
        }
        alreadyApplied.push(migration.version);
        continue;
      }

      await applyPendingMigration(client, migration);
      applied.push(migration.version);
      onStatus?.({ status: 'applied', version: migration.version });
    }

    return { applied, alreadyApplied, migrations };
  } finally {
    if (lockHeld) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [advisoryLockKey]).catch(() => {});
    }
  }
}

export async function runPostgresMigrations({
  connectionString = process.env.DATABASE_URL,
  ssl = resolvePgSslConfig(process.env.PGSSLMODE, { rootCertPath: process.env.PGSSLROOTCERT }),
  migrationsDir = defaultMigrationsDir,
  onStatus,
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run PostgreSQL migrations.');
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString, ssl });
  try {
    await client.connect();
    return await applyPostgresMigrations(client, { migrationsDir, onStatus });
  } finally {
    await client.end().catch(() => {});
  }
}
