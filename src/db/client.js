import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

try {
  process.loadEnvFile?.();
} catch {
  // No .env file in CWD; use the real process environment.
}

const { Pool } = pg;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const driver = String(process.env.DB_DRIVER || '').toLowerCase();
const usePostgres = driver === 'postgres' || (!driver && Boolean(process.env.DATABASE_URL));
const pgPoolKey = Symbol.for('esports-community-bot.pgPool');

let sqliteDbPromise = null;

function sqliteParams(sql, params = []) {
  if (!Array.isArray(params)) return { sql, params };
  const ordered = [];
  return {
    sql: sql.replace(/\$(\d+)/g, (_match, index) => {
      ordered.push(params[Number(index) - 1]);
      return '?';
    }),
    params: ordered.length ? ordered : params,
  };
}

function postgresSslConfig() {
  const mode = String(process.env.PGSSLMODE || '').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

async function sqliteDb() {
  if (!sqliteDbPromise) {
    sqliteDbPromise = import('./connection.js').then((mod) => mod.db);
  }
  return sqliteDbPromise;
}

function postgresPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when DB_DRIVER=postgres.');
  const existing = globalThis[pgPoolKey];
  if (existing) return existing;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSslConfig(),
  });
  globalThis[pgPoolKey] = pool;
  return pool;
}

function postgresClient(client) {
  return {
    async exec(sql) {
      await client.query(sql);
    },
    async all(sql, params = []) {
      const result = await client.query(sql, params);
      return result.rows;
    },
    async get(sql, params = []) {
      const result = await client.query(sql, params);
      return result.rows[0] ?? null;
    },
    async run(sql, params = []) {
      const result = await client.query(sql, params);
      return { changes: result.rowCount || 0, rowCount: result.rowCount || 0, rows: result.rows };
    },
  };
}

function sqliteClient(database) {
  return {
    async exec(sql) {
      database.exec(sql);
    },
    async all(sql, params = []) {
      const query = sqliteParams(sql, params);
      return database.prepare(query.sql).all(query.params);
    },
    async get(sql, params = []) {
      const query = sqliteParams(sql, params);
      return database.prepare(query.sql).get(query.params) ?? null;
    },
    async run(sql, params = []) {
      const query = sqliteParams(sql, params);
      const result = database.prepare(query.sql).run(query.params);
      return { ...result, rowCount: result.changes };
    },
  };
}

export function dbDriver() {
  return usePostgres ? 'postgres' : 'sqlite';
}

export function isPostgres() {
  return usePostgres;
}

export async function dbClient() {
  if (usePostgres) return postgresClient(postgresPool());
  return sqliteClient(await sqliteDb());
}

export async function exec(sql) {
  return (await dbClient()).exec(sql);
}

export async function all(sql, params = []) {
  return (await dbClient()).all(sql, params);
}

export async function get(sql, params = []) {
  return (await dbClient()).get(sql, params);
}

export async function run(sql, params = []) {
  return (await dbClient()).run(sql, params);
}

export async function transaction(fn) {
  if (usePostgres) {
    const client = await postgresPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(postgresClient(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const database = await sqliteDb();
  const client = sqliteClient(database);
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = await fn(client);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export async function closeDbClient() {
  if (usePostgres) {
    const pool = globalThis[pgPoolKey];
    if (pool) {
      delete globalThis[pgPoolKey];
      await pool.end();
    }
    return;
  }

  const mod = await import('./connection.js');
  mod.closeDb();
  sqliteDbPromise = null;
}

export async function ensurePostgresAppSchema() {
  if (!usePostgres) return;
  const schema = readFileSync(resolve(rootDir, 'scripts/postgres/schema.sql'), 'utf8');
  await exec(schema);
}
