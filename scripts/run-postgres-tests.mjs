import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';

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

function safeErrorMessage(error, config) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]');
  message = message.replace(/password\s*=\s*[^\s,;]+/gi, 'password=[redacted]');
  if (config?.url) message = message.split(config.url).join('[redacted-url]');
  try {
    const password = config?.url ? new URL(config.url).password : '';
    if (password) message = message.split(decodeURIComponent(password)).join('[redacted]');
  } catch {
    // The validated URL was already parsed; this is only defensive redaction.
  }
  return message;
}

async function resetAndApplySchema(config) {
  const client = new pg.Client({ connectionString: config.url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    const schema = await readFile(resolve('scripts/postgres/schema.sql'), 'utf8');
    await client.query(schema);
  } finally {
    await client.end();
  }
}

async function run() {
  let config;
  try {
    config = validatePostgresTestConfig();
    console.log(`[postgres-test] resetting disposable database ${config.database} on ${config.host}`);
    await resetAndApplySchema(config);
  } catch (error) {
    console.error(`[postgres-test] ${safeErrorMessage(error, config)}`);
    process.exitCode = 1;
    return;
  }

  const forwardedArgs = process.argv.slice(2);
  const testFile = resolve('tests/postgresDbParity.test.mjs');
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

  child.once('error', (error) => {
    console.error(`[postgres-test] unable to start Node test runner: ${safeErrorMessage(error, config)}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`[postgres-test] Node test runner exited after signal ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await run();
}
