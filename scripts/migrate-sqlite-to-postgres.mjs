import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import pg from 'pg';
import { resolvePgSslConfig, runPostgresMigrations, sanitizePostgresError } from '../src/db/postgresMigrations.js';

try {
  process.loadEnvFile?.();
} catch {
  // No local .env file; use the real environment.
}

const { Pool } = pg;

// Every app table, in migration snapshot declaration order. The order is
// foreign-key safe for both schema creation and row copying.
const appTables = [
  'tournaments',
  'matches',
  'match_details',
  'teams',
  'players',
  'mvp_vote_sessions',
  'mvp_vote_nominees',
  'mvp_votes',
  'guild_settings',
  'game_leaderboards',
  'game_voice_channels',
  'game_match_cards',
  'match_card_messages',
  'ewc_prediction_weeks',
  'ewc_weekly_predictions',
  'ewc_prediction_reminders',
  'ewc_prediction_operations',
  'ewc_prediction_operation_health',
  'ewc_prediction_seasons',
  'ewc_season_predictions',
  'ewc_prediction_leagues',
  'ewc_prediction_league_members',
  'ewc_club_championship_snapshots',
  'ewc_club_championship_snapshot_history',
  'ewc_profile_links',
  'ewc_public_predictor_identities',
  'ewc_news_posts',
  'ewc_news_post_translations',
  'ewc_news_post_authors',
  'ewc_news_discord_posts',
  'ewc_games',
  'ewc_media_channels',
  'ewc_media_discord_posts',
  'ewc_rate_limits',
  'post_comments',
  'post_likes',
  'comment_likes',
  'comment_moderation_actions',
  'comment_keyword_rules',
  'comment_reports',
  'community_user_blocks',
  'partner_inquiries',
  'partners',
  'partner_campaigns',
  'ewc_admins',
  'ewc_admin_game_scopes',
  'ewc_admin_media_scopes',
  'ewc_admin_audit_log',
  'ewc_mcp_keys',
  'ewc_mcp_write_receipts',
  'stream_channels',
  'stream_channel_status',
  'stream_creator_announce_state',
  'user_follows',
  'user_match_reminders',
  'user_notification_prefs',
  'user_notifications',
  'web_analytics_events',
  'web_product_events',
  'tournament_standings',
  'tournament_sync_health',
];

const authTables = ['user', 'session', 'account', 'verification'];

// Every PostgreSQL identity column whose explicit imported values require a
// sequence reset before the transaction can be committed.
const identityColumns = new Map([
  ['tournaments', 'id'],
  ['matches', 'id'],
  ['teams', 'id'],
  ['players', 'id'],
  ['mvp_vote_sessions', 'id'],
  ['mvp_vote_nominees', 'id'],
  ['ewc_prediction_weeks', 'id'],
  ['ewc_news_posts', 'id'],
  ['ewc_admin_audit_log', 'id'],
  ['ewc_mcp_keys', 'id'],
  ['post_comments', 'id'],
  ['comment_moderation_actions', 'id'],
  ['comment_keyword_rules', 'id'],
  ['comment_reports', 'id'],
  ['partner_inquiries', 'id'],
  ['partners', 'id'],
  ['partner_campaigns', 'id'],
  ['stream_channels', 'id'],
  ['user_follows', 'id'],
  ['user_notifications', 'id'],
  ['web_analytics_events', 'id'],
  ['web_product_events', 'id'],
  ['tournament_standings', 'id'],
]);

// Supported legacy differences must be named here. Unknown source or target
// columns abort the import instead of being silently discarded.
const tableMappings = Object.freeze({
  post_comments: Object.freeze({
    derivedTargetColumns: Object.freeze({
      target_type: Object.freeze({
        description: 'legacy comments are news comments',
        derive: (row) => row.target_type ?? 'news',
      }),
      target_id: Object.freeze({
        description: 'legacy news comment target is its post id',
        derive: (row) => row.target_id ?? row.post_id,
      }),
    }),
    ignoredSourceColumns: Object.freeze({}),
  }),
});

function parseArgs(argv) {
  const args = {
    dryRun: false,
    preflightTarget: false,
    schemaOnly: false,
    skipSchema: false,
    includeAuth: false,
    sqlite: process.env.SQLITE_PATH || process.env.DB_PATH || 'data/bot.sqlite',
    databaseUrl: process.env.DATABASE_URL || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--preflight-target') args.preflightTarget = true;
    else if (arg === '--schema-only') args.schemaOnly = true;
    else if (arg === '--skip-schema') args.skipSchema = true;
    else if (arg === '--include-auth') args.includeAuth = true;
    else if (arg === '--sqlite') args.sqlite = argv[++i];
    else if (arg === '--database-url') {
      throw new Error('Use DATABASE_URL instead of --database-url so credentials do not appear in process listings.');
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.sqlite && !args.schemaOnly) throw new Error('--sqlite requires a path.');
  const exclusiveModes = [args.dryRun, args.preflightTarget, args.schemaOnly].filter(Boolean).length;
  if (exclusiveModes > 1) {
    throw new Error('--dry-run, --preflight-target, and --schema-only are mutually exclusive.');
  }
  if (args.schemaOnly && args.skipSchema) {
    throw new Error('--schema-only cannot be combined with --skip-schema.');
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/migrate-sqlite-to-postgres.mjs --dry-run --sqlite ./bot.sqlite
  DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-postgres.mjs --preflight-target --sqlite ./bot.sqlite
  DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-postgres.mjs --sqlite ./bot.sqlite

Options:
  --sqlite <path>       SQLite source path. Defaults to SQLITE_PATH, DB_PATH, then data/bot.sqlite.
  --dry-run             Print a source-only inventory. Does not connect to PostgreSQL.
  --preflight-target    Validate source mapping and an empty target without copying rows.
  --schema-only         Apply versioned app migrations and exit.
  --skip-schema         Do not apply app migrations before preflight/import.
  --include-auth        Copy Better Auth tables only when they already exist in both databases.

Environment:
  DATABASE_URL          PostgreSQL connection string. Required for target operations.
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

function quoteQualifiedIdent(value) {
  return String(value)
    .split('.')
    .map(quoteIdent)
    .join('.');
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
  return Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`).get().count);
}

async function postgresColumns(client, table) {
  const result = await client.query(
    `SELECT column_name, is_nullable, column_default, is_identity, identity_generation
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return result.rows;
}

async function postgresCount(client, table) {
  const result = await client.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`);
  return Number(result.rows[0]?.count || 0);
}

function mappingFor(table) {
  return tableMappings[table] || {
    derivedTargetColumns: {},
    ignoredSourceColumns: {},
  };
}

function buildColumnMapping({ table, sourceColumns, targetColumns }) {
  const targetNames = targetColumns.map((column) =>
    typeof column === 'string' ? column : column.column_name,
  );
  const sourceSet = new Set(sourceColumns);
  const targetSet = new Set(targetNames);
  const config = mappingFor(table);

  const unexpectedSource = sourceColumns.filter(
    (column) => !targetSet.has(column) && !Object.hasOwn(config.ignoredSourceColumns, column),
  );
  if (unexpectedSource.length) {
    throw new Error(
      `Schema mismatch for ${table}: source-only column(s): ${unexpectedSource.join(', ')}`,
    );
  }

  const columns = targetNames.map((column) => {
    if (sourceSet.has(column)) {
      return { targetColumn: column, sourceColumn: column, derive: null };
    }
    const derived = config.derivedTargetColumns[column];
    if (derived) {
      return { targetColumn: column, sourceColumn: null, derive: derived.derive };
    }
    throw new Error(`Schema mismatch for ${table}: target-only column(s): ${column}`);
  });

  return {
    columns,
    ignoredSourceColumns: unexpectedSource,
  };
}

function readRows(sqlite, table, sourceColumns) {
  const selectList = sourceColumns.map(quoteIdent).join(', ');
  // Creation order keeps self-referential comment parents ahead of replies and
  // makes repeated synthetic test runs deterministic.
  return sqlite.prepare(`SELECT ${selectList} FROM ${quoteIdent(table)} ORDER BY rowid`).all();
}

async function inspectMappings({ sqlite, client, tables }) {
  const mappings = new Map();
  for (const table of tables) {
    if (!sqliteTableExists(sqlite, table)) {
      throw new Error(`Schema mismatch for ${table}: missing in SQLite source`);
    }
    const sourceColumns = sqliteColumns(sqlite, table);
    const targetColumns = await postgresColumns(client, table);
    if (!targetColumns.length) {
      throw new Error(`Schema mismatch for ${table}: missing in PostgreSQL target`);
    }
    mappings.set(table, {
      sourceColumns,
      targetColumns,
      ...buildColumnMapping({ table, sourceColumns, targetColumns }),
    });
  }
  return mappings;
}

async function lockAndRejectDirtyTargets(client, tables) {
  const tableSql = tables.map(quoteIdent).join(', ');
  await client.query(`LOCK TABLE ${tableSql} IN ACCESS EXCLUSIVE MODE`);

  const dirty = [];
  for (const table of tables) {
    const count = await postgresCount(client, table);
    if (count > 0) dirty.push(`${table} (${count})`);
  }
  if (dirty.length) {
    throw new Error(`PostgreSQL target is not empty: ${dirty.join(', ')}`);
  }
}

async function copyTable({ sqlite, client, table, mapping }) {
  const rows = readRows(sqlite, table, mapping.sourceColumns);
  if (!rows.length) {
    return { table, source: 0, expected: 0, inserted: 0, target: 0 };
  }

  const targetNames = mapping.columns.map(({ targetColumn }) => targetColumn);
  const columnSql = targetNames.map(quoteIdent).join(', ');
  const valuesSql = targetNames.map((_, index) => `$${index + 1}`).join(', ');
  const insertSql = `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES (${valuesSql})`;

  let inserted = 0;
  for (const row of rows) {
    const values = mapping.columns.map(({ sourceColumn, derive }) =>
      derive ? derive(row) : row[sourceColumn],
    );
    const result = await client.query(insertSql, values);
    inserted += result.rowCount || 0;
  }

  return {
    table,
    source: rows.length,
    expected: rows.length,
    inserted,
    target: null,
  };
}

async function resetIdentity(client, table, column) {
  const result = await client.query(
    `SELECT pg_get_serial_sequence($1, $2) AS sequence_name,
            COALESCE(MAX(${quoteIdent(column)}), 0)::bigint AS max_id
     FROM ${quoteIdent(table)}`,
    [table, column],
  );
  const sequenceName = result.rows[0]?.sequence_name;
  const maxId = BigInt(result.rows[0]?.max_id || 0);
  if (!sequenceName) {
    throw new Error(`Identity validation failed for ${table}.${column}: sequence not found`);
  }

  await client.query(
    `SELECT setval($1, GREATEST($2::bigint, 1), $2::bigint > 0)`,
    [sequenceName, maxId.toString()],
  );
  return { table, column, sequenceName, maxId };
}

async function validateIdentity(client, identity) {
  const result = await client.query(
    `SELECT last_value::bigint AS last_value, is_called
     FROM ${quoteQualifiedIdent(identity.sequenceName)}`,
  );
  const lastValue = BigInt(result.rows[0]?.last_value || 0);
  const isCalled = Boolean(result.rows[0]?.is_called);
  const nextValue = isCalled ? lastValue + 1n : lastValue;
  const expectedNext = identity.maxId > 0n ? identity.maxId + 1n : 1n;
  if (nextValue !== expectedNext) {
    throw new Error(
      `Identity validation failed for ${identity.table}.${identity.column}: expected next ${expectedNext}, got ${nextValue}`,
    );
  }
}

async function validateConstraints(client, tables) {
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  const result = await client.query(
    `SELECT rel.relname AS table_name, constraint_row.conname
     FROM pg_constraint AS constraint_row
     JOIN pg_class AS rel ON rel.oid = constraint_row.conrelid
     JOIN pg_namespace AS namespace ON namespace.oid = rel.relnamespace
     WHERE namespace.nspname = 'public'
       AND rel.relname = ANY($1::text[])
       AND constraint_row.convalidated = false
     ORDER BY rel.relname, constraint_row.conname`,
    [tables],
  );
  if (result.rows.length) {
    const names = result.rows.map((row) => `${row.table_name}.${row.conname}`);
    throw new Error(`Unvalidated PostgreSQL constraint(s): ${names.join(', ')}`);
  }
}

async function validateCopy(client, results) {
  for (const result of results) {
    if (result.inserted !== result.expected) {
      throw new Error(
        `Row-count validation failed for ${result.table}: expected ${result.expected}, inserted ${result.inserted}`,
      );
    }
    result.target = await postgresCount(client, result.table);
    if (result.target !== result.expected) {
      throw new Error(
        `Row-count validation failed for ${result.table}: expected ${result.expected}, target has ${result.target}`,
      );
    }
  }
}

function printSourceSummary(sqlite, tables, log = console.log) {
  log('SQLite source inventory (no target checks performed):');
  for (const table of tables) {
    const count = sqliteCount(sqlite, table);
    if (count == null) log(`- ${table}: missing`);
    else log(`- ${table}: ${count}`);
  }
}

async function runTargetOperation({
  sqlitePath,
  databaseUrl,
  includeAuth = false,
  skipSchema = false,
  preflightOnly = false,
  hooks = {},
  log = console.log,
}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for target operations.');
  if (!existsSync(sqlitePath)) throw new Error(`SQLite source not found: ${sqlitePath}`);

  const tables = includeAuth ? [...appTables, ...authTables] : appTables;
  const ssl = resolvePgSslConfig(process.env.PGSSLMODE, {
    rootCertPath: process.env.PGSSLROOTCERT,
  });
  if (!skipSchema) {
    log('Applying versioned PostgreSQL app migrations...');
    await runPostgresMigrations({ connectionString: databaseUrl, ssl });
  }

  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({ connectionString: databaseUrl, ssl });
  let client = null;
  let committed = false;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const mappings = await inspectMappings({ sqlite, client, tables });
    await lockAndRejectDirtyTargets(client, tables);

    if (preflightOnly) {
      await client.query('ROLLBACK');
      log('Target preflight passed. Schema mapping is exact and all selected target tables are empty.');
      return { mode: 'preflight', tables: tables.length };
    }

    log('Copying rows...');
    const results = [];
    for (const table of tables) {
      const result = await copyTable({
        sqlite,
        client,
        table,
        mapping: mappings.get(table),
      });
      results.push(result);
      log(`- ${table}: inserted ${result.inserted}`);
      await hooks.afterTable?.({ client, table, result, results });
    }

    const identities = [];
    for (const [table, column] of identityColumns) {
      if (tables.includes(table)) {
        identities.push(await resetIdentity(client, table, column));
      }
    }

    await hooks.beforeValidation?.({ client, results });
    await validateCopy(client, results);
    await validateConstraints(client, tables);
    for (const identity of identities) await validateIdentity(client, identity);
    await hooks.afterValidation?.({ client, results });

    await client.query('COMMIT');
    committed = true;
    log('Import committed after in-transaction row-count, constraint, and identity validation.');
    return { mode: 'import', results };
  } catch (error) {
    if (client && !committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure; the connection will be discarded.
      }
    }
    throw error;
  } finally {
    sqlite.close();
    client?.release();
    await pool.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const sqlitePath = resolve(args.sqlite);
  const tables = args.includeAuth ? [...appTables, ...authTables] : appTables;

  if (args.schemaOnly) {
    if (!args.databaseUrl) throw new Error('DATABASE_URL is required for --schema-only.');
    const ssl = resolvePgSslConfig(process.env.PGSSLMODE, {
      rootCertPath: process.env.PGSSLROOTCERT,
    });
    await runPostgresMigrations({ connectionString: args.databaseUrl, ssl });
    console.log('Versioned PostgreSQL app migrations applied.');
    return;
  }

  if (!existsSync(sqlitePath)) throw new Error(`SQLite source not found: ${sqlitePath}`);
  if (args.dryRun) {
    const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      printSourceSummary(sqlite, tables);
      console.log('Source-only dry run complete. No PostgreSQL connection was opened.');
    } finally {
      sqlite.close();
    }
    return;
  }

  await runTargetOperation({
    sqlitePath,
    databaseUrl: args.databaseUrl,
    includeAuth: args.includeAuth,
    skipSchema: args.skipSchema,
    preflightOnly: args.preflightTarget,
  });
}

export {
  appTables,
  authTables,
  buildColumnMapping,
  identityColumns,
  parseArgs,
  printHelp,
  runTargetOperation,
  tableMappings,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(sanitizePostgresError(error, process.env.DATABASE_URL));
    process.exitCode = 1;
  });
}
