import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import pg from 'pg';

try {
  process.loadEnvFile?.();
} catch {
  // No local .env file; use the real environment.
}

const { Pool } = pg;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(rootDir, 'scripts/postgres/schema.sql');

const appTables = [
  'tournaments',
  'matches',
  'teams',
  'players',
  'guild_settings',
  'game_leaderboards',
  'game_voice_channels',
  'game_match_cards',
  'match_card_messages',
  'ewc_prediction_weeks',
  'ewc_weekly_predictions',
  'ewc_prediction_seasons',
  'ewc_season_predictions',
  'ewc_profile_links',
  'ewc_news_posts',
  'ewc_news_post_translations',
  'ewc_news_discord_posts',
  'ewc_games',
  'ewc_media_channels',
  'ewc_rate_limits',
  'ewc_admins',
  'ewc_admin_game_scopes',
  'ewc_admin_media_scopes',
  'ewc_admin_audit_log',
];

const authTables = ['user', 'session', 'account', 'verification'];

const identityColumns = new Map([
  ['tournaments', 'id'],
  ['matches', 'id'],
  ['teams', 'id'],
  ['players', 'id'],
  ['ewc_prediction_weeks', 'id'],
  ['ewc_news_posts', 'id'],
  ['ewc_admin_audit_log', 'id'],
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    schemaOnly: false,
    skipSchema: false,
    includeAuth: false,
    sqlite: process.env.SQLITE_PATH || process.env.DB_PATH || 'data/bot.sqlite',
    databaseUrl: process.env.DATABASE_URL || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--schema-only') args.schemaOnly = true;
    else if (arg === '--skip-schema') args.skipSchema = true;
    else if (arg === '--include-auth') args.includeAuth = true;
    else if (arg === '--sqlite') args.sqlite = argv[++i];
    else if (arg === '--database-url') args.databaseUrl = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/migrate-sqlite-to-postgres.mjs --dry-run --sqlite ./bot.sqlite
  DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-postgres.mjs --sqlite ./bot.sqlite

Options:
  --sqlite <path>       SQLite source path. Defaults to SQLITE_PATH, DB_PATH, then data/bot.sqlite.
  --database-url <url>  PostgreSQL target URL. Defaults to DATABASE_URL.
  --dry-run             Inspect source counts only. Does not connect to PostgreSQL.
  --schema-only         Apply scripts/postgres/schema.sql and exit.
  --skip-schema         Do not apply scripts/postgres/schema.sql before copying.
  --include-auth        Also copy Better Auth tables if they already exist in PostgreSQL.

Environment:
  DATABASE_URL          PostgreSQL connection string.
  PGSSLMODE=require     Use TLS without local CA verification.
  PGSSLMODE=disable     Use plain TCP.
`);
}

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function sqliteTableExists(sqlite, table) {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function sqliteColumns(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((column) => column.name);
}

function sqliteCount(sqlite, table) {
  if (!sqliteTableExists(sqlite, table)) return null;
  return sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`).get().count;
}

async function postgresColumns(client, table) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function postgresCount(client, table) {
  const result = await client.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`);
  return Number(result.rows[0]?.count || 0);
}

async function applySchema(client) {
  const sql = readFileSync(schemaPath, 'utf8');
  await client.query(sql);
}

function postgresSslConfig() {
  const mode = String(process.env.PGSSLMODE || '').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

function readRows(sqlite, table, columns) {
  const selectList = columns.map(quoteIdent).join(', ');
  return sqlite.prepare(`SELECT ${selectList} FROM ${quoteIdent(table)}`).all();
}

async function copyTable({ sqlite, client, table }) {
  if (!sqliteTableExists(sqlite, table)) {
    return { table, copied: 0, skipped: true, reason: 'missing in SQLite source' };
  }

  const sourceColumns = sqliteColumns(sqlite, table);
  const targetColumns = await postgresColumns(client, table);
  if (!targetColumns.length) {
    return { table, copied: 0, skipped: true, reason: 'missing in PostgreSQL target' };
  }

  const columns = sourceColumns.filter((column) => targetColumns.includes(column));
  if (!columns.length) {
    return { table, copied: 0, skipped: true, reason: 'no shared columns' };
  }

  const rows = readRows(sqlite, table, columns);
  if (!rows.length) return { table, copied: 0, skipped: false };

  const columnSql = columns.map(quoteIdent).join(', ');
  const valuesSql = columns.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES (${valuesSql}) ON CONFLICT DO NOTHING`;

  let copied = 0;
  for (const row of rows) {
    const values = columns.map((column) => row[column]);
    const result = await client.query(insertSql, values);
    copied += result.rowCount || 0;
  }

  return { table, copied, skipped: false };
}

async function resetIdentity(client, table, column) {
  const sql = `
    SELECT setval(
      pg_get_serial_sequence($1, $2),
      GREATEST(COALESCE(MAX(${quoteIdent(column)}), 1), 1),
      COALESCE(MAX(${quoteIdent(column)}), 0) > 0
    )
    FROM ${quoteIdent(table)}
  `;
  await client.query(sql, [table, column]);
}

function printSourceSummary(sqlite, tables) {
  console.log('SQLite source summary:');
  for (const table of tables) {
    const count = sqliteCount(sqlite, table);
    if (count == null) console.log(`- ${table}: missing`);
    else console.log(`- ${table}: ${count}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqlitePath = resolve(args.sqlite);

  if (!existsSync(sqlitePath) && !args.schemaOnly) {
    throw new Error(`SQLite source not found: ${sqlitePath}`);
  }

  const tables = args.includeAuth ? [...appTables, ...authTables] : appTables;
  const sqlite = args.schemaOnly ? null : new Database(sqlitePath, { readonly: true, fileMustExist: true });

  if (sqlite) printSourceSummary(sqlite, tables);

  if (args.dryRun) {
    sqlite?.close();
    console.log('Dry run complete. No PostgreSQL connection was opened.');
    return;
  }

  if (!args.databaseUrl) {
    throw new Error('DATABASE_URL is required unless --dry-run is used.');
  }

  const pool = new Pool({
    connectionString: args.databaseUrl,
    ssl: postgresSslConfig(),
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (!args.skipSchema) {
      console.log('Applying PostgreSQL app schema...');
      await applySchema(client);
    }

    if (!args.schemaOnly) {
      console.log('Copying rows...');
      for (const table of tables) {
        const result = await copyTable({ sqlite, client, table });
        if (result.skipped) console.log(`- ${table}: skipped (${result.reason})`);
        else console.log(`- ${table}: inserted ${result.copied}`);
      }

      for (const [table, column] of identityColumns) {
        await resetIdentity(client, table, column);
      }
    }

    await client.query('COMMIT');

    if (!args.schemaOnly) {
      console.log('PostgreSQL target counts:');
      for (const table of tables) {
        const columns = await postgresColumns(client, table);
        if (!columns.length) console.log(`- ${table}: missing`);
        else console.log(`- ${table}: ${await postgresCount(client, table)}`);
      }
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    sqlite?.close();
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
