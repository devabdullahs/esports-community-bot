import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';
import {
  listPostgresMigrations,
  resolvePgSslConfig,
  runPostgresMigrations,
  sanitizePostgresError,
} from '../src/db/postgresMigrations.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const TRUE_VALUES = new Set(['1', 'true']);

function enabled(value) {
  return TRUE_VALUES.has(String(value || '').trim().toLowerCase());
}

function decodedDatabaseName(url) {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  return segments.length === 1 ? segments[0] : '';
}

export function validatePostgresTestConfig(env = process.env) {
  if (env.ALLOW_POSTGRES_TEST_RESET !== '1') {
    throw new Error('Refusing to reset PostgreSQL without ALLOW_POSTGRES_TEST_RESET=1.');
  }
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for PostgreSQL parity tests.');
  }

  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }

  const database = decodedDatabaseName(url);
  if (!database || !database.endsWith('_test')) {
    throw new Error('PostgreSQL parity tests require a database name ending in _test.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isCi = enabled(env.CI) || enabled(env.GITHUB_ACTIONS);
  if (isCi) {
    if (env.POSTGRES_TEST_HOST_ALLOWED !== '1') {
      throw new Error('CI PostgreSQL resets require POSTGRES_TEST_HOST_ALLOWED=1.');
    }
  } else if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error('Local PostgreSQL parity tests may only reset a loopback host.');
  }

  return {
    database,
    host,
    url: env.DATABASE_URL,
  };
}

function sslForCurrentEnvironment() {
  return resolvePgSslConfig(process.env.PGSSLMODE, { rootCertPath: process.env.PGSSLROOTCERT });
}

async function resetDatabase(config) {
  const client = new pg.Client({ connectionString: config.url, ssl: sslForCurrentEnvironment() });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

async function assertMigrationLedger(config) {
  const expected = listPostgresMigrations().map(({ version, checksum }) => ({ version, checksum }));
  const client = new pg.Client({ connectionString: config.url, ssl: sslForCurrentEnvironment() });
  await client.connect();
  try {
    const result = await client.query('SELECT version, checksum FROM app_schema_migrations ORDER BY version ASC');
    const actual = result.rows.map(({ version, checksum }) => ({ version, checksum }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('PostgreSQL migration ledger does not match the checked-in migration set.');
    }
  } finally {
    await client.end();
  }
}

function runTestFile(config, testFile, forwardedArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['--test', ...forwardedArgs, testFile], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DB_DRIVER: 'postgres',
        DATABASE_URL: config.url,
        ALLOW_POSTGRES_TEST_RESET: '1',
        PGSSLMODE: process.env.PGSSLMODE || 'disable',
      },
    });

    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectRun(new Error('Node test runner exited after signal ' + signal + '.'));
      } else if (code !== 0) {
        rejectRun(new Error('Node test runner exited with code ' + code + '.'));
      } else {
        resolveRun();
      }
    });
  });
}

async function run() {
  let config;
  try {
    config = validatePostgresTestConfig();
    console.log('[postgres-test] resetting disposable database ' + config.database + ' on ' + config.host);
    const forwardedArgs = process.argv.slice(2);

    await resetDatabase(config);
    await runTestFile(config, resolve('tests/postgresMigrations.test.mjs'), forwardedArgs);

    await resetDatabase(config);
    await runPostgresMigrations({ connectionString: config.url, ssl: sslForCurrentEnvironment() });
    await runPostgresMigrations({ connectionString: config.url, ssl: sslForCurrentEnvironment() });
    await assertMigrationLedger(config);
    await runTestFile(config, resolve('tests/postgresDbParity.test.mjs'), forwardedArgs);

    await resetDatabase(config);
    await runTestFile(config, resolve('tests/sqliteToPostgresImport.test.mjs'), forwardedArgs);
  } catch (error) {
    console.error('[postgres-test] ' + sanitizePostgresError(error, config?.url));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await run();
}
