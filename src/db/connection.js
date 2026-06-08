import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

try {
  process.loadEnvFile?.();
} catch {
  // No .env file in CWD; use the real process environment.
}

const dbPath = process.env.DB_PATH || 'data/bot.sqlite';
mkdirSync(dirname(dbPath), { recursive: true });

const key = Symbol.for('esports-community-bot.db');
const existing = globalThis[key];

export const db =
  existing ||
  (() => {
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    globalThis[key] = database;
    return database;
  })();

export function closeDb() {
  try {
    db.close();
    if (globalThis[key] === db) delete globalThis[key];
  } catch {
    /* already closed */
  }
}
