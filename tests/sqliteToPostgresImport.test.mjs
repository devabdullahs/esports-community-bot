import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import pg from 'pg';
import test from 'node:test';

import { runTargetOperation } from '../scripts/migrate-sqlite-to-postgres.mjs';
import {
  resolvePgSslConfig,
  runPostgresMigrations,
} from '../src/db/postgresMigrations.js';

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const postgresEnabled =
  process.env.DB_DRIVER === 'postgres' &&
  process.env.ALLOW_POSTGRES_TEST_RESET === '1' &&
  Boolean(process.env.DATABASE_URL);

function postgresOptions() {
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: resolvePgSslConfig(process.env.PGSSLMODE, {
      rootCertPath: process.env.PGSSLROOTCERT,
    }),
  };
}

async function resetTarget({ migrate = false } = {}) {
  const client = new pg.Client(postgresOptions());
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  if (migrate) await runPostgresMigrations(postgresOptions());
}

async function queryTarget(sql, params = []) {
  const client = new pg.Client(postgresOptions());
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function createInitializedSqlite() {
  const directory = await mkdtemp(join(tmpdir(), 'ecb-sqlite-import-'));
  const sqlitePath = join(directory, 'source.sqlite');
  const moduleUrl = pathToFileURL(join(root, 'src/db/index.js')).href;
  const source = `
    process.env.DB_PATH = ${JSON.stringify(sqlitePath)};
    const database = await import(${JSON.stringify(moduleUrl)});
    database.closeDb();
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root,
    env: {
      ...process.env,
      DB_DRIVER: 'sqlite',
      DB_PATH: sqlitePath,
    },
  });

  const sqlite = new Database(sqlitePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    INSERT INTO tournaments
      (id, source, external_id, game, name, guild_id, ewc, active)
    VALUES
      (41, 'liquipedia', 'fixture-tournament', 'valorant', 'Synthetic Cup', 'fixture-guild', 1, 1);

    INSERT INTO matches
      (id, tournament_id, source, external_id, name, team_a, team_b, status, scheduled_at)
    VALUES
      (51, 41, 'liquipedia', 'fixture-match', 'Synthetic final', 'Alpha', 'Bravo', 'finished', 1780000000);

    INSERT INTO teams (id, game, name, slug)
    VALUES (501, 'valorant', 'Synthetic Team', 'synthetic-team');

    INSERT INTO ewc_prediction_weeks
      (id, guild_id, season, week_key, label, status, games_json)
    VALUES
      (61, 'fixture-guild', '2026', 'week-fixture', 'Fixture week', 'closed', '["valorant"]');

    INSERT INTO ewc_weekly_predictions
      (guild_id, week_id, user_id, picks_json, score)
    VALUES
      ('fixture-guild', 61, 'fixture-user', '{"valorant":"Synthetic Team"}', 100);

    INSERT INTO ewc_prediction_reminders
      (guild_id, week_id, game_key, kind, sent_at)
    VALUES
      ('fixture-guild', 61, 'valorant', 'closing', '2026-07-01T00:00:00.000Z');

    INSERT INTO ewc_profile_links
      (auth_user_id, discord_user_id, guild_id, season, public_display_name)
    VALUES
      ('fixture-auth-user', 'fixture-discord-user', 'fixture-guild', '2026', 'Fixture user');

    INSERT INTO ewc_news_posts
      (id, game_slug, locale, title, summary, body, status)
    VALUES
      (71, 'valorant', 'en', 'Synthetic report', 'Summary', 'Body', 'published');

    INSERT INTO ewc_news_post_translations
      (post_id, locale, title, summary, body)
    VALUES
      (71, 'ar', 'Synthetic Arabic', 'Summary', 'Body');

    INSERT INTO ewc_news_post_authors
      (post_id, discord_id, name, sort_order)
    VALUES
      (71, 'fixture-author', 'Fixture author', 0);

    INSERT INTO post_comments
      (id, post_id, target_type, target_id, auth_user_id, discord_user_id, author_name, body)
    VALUES
      (81, 71, 'news', 71, 'fixture-auth-user', 'fixture-discord-user', 'Fixture user', 'Fixture comment');

    INSERT INTO web_analytics_events
      (id, visitor_id, session_id, event_type, path, acquisition_source, duration_seconds, occurred_at)
    VALUES
      (91, 'fixture-visitor', 'fixture-session', 'pageview', '/fixture', 'direct', 0, 1780000000);
  `);
  sqlite.close();

  return {
    directory,
    sqlitePath,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function withFixture(fn) {
  const fixture = await createInitializedSqlite();
  try {
    return await fn(fixture);
  } finally {
    await fixture.cleanup();
  }
}

test(
  'SQLite import copies exact counts, preserves foreign keys, and resets identities',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      const result = await runTargetOperation({
        sqlitePath,
        databaseUrl: process.env.DATABASE_URL,
        log() {},
      });
      assert.equal(result.mode, 'import');

      const counts = await queryTarget(`
        SELECT
          (SELECT COUNT(*)::int FROM tournaments) AS tournaments,
          (SELECT COUNT(*)::int FROM matches) AS matches,
          (SELECT COUNT(*)::int FROM ewc_news_posts) AS posts,
          (SELECT COUNT(*)::int FROM post_comments) AS comments,
          (SELECT COUNT(*)::int FROM web_analytics_events) AS analytics
      `);
      assert.deepEqual(counts.rows[0], {
        tournaments: 1,
        matches: 1,
        posts: 1,
        comments: 1,
        analytics: 1,
      });

      const relationship = await queryTarget(`
        SELECT matches.external_id, tournaments.external_id AS tournament_external_id
        FROM matches
        JOIN tournaments ON tournaments.id = matches.tournament_id
      `);
      assert.deepEqual(relationship.rows[0], {
        external_id: 'fixture-match',
        tournament_external_id: 'fixture-tournament',
      });

      const inserted = await queryTarget(`
        INSERT INTO tournaments (source, external_id, guild_id)
        VALUES ('liquipedia', 'after-import', 'fixture-guild')
        RETURNING id
      `);
      assert.ok(Number(inserted.rows[0].id) > 41);
    });
  },
);

test(
  'SQLite import target preflight validates without copying',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      const result = await runTargetOperation({
        sqlitePath,
        databaseUrl: process.env.DATABASE_URL,
        preflightOnly: true,
        log() {},
      });
      assert.equal(result.mode, 'preflight');
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM tournaments')).rows[0].count), 0);
    });
  },
);

test(
  'SQLite import rejects a dirty target without changing it',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget({ migrate: true });
    await queryTarget(`
      INSERT INTO tournaments (source, external_id, guild_id)
      VALUES ('liquipedia', 'existing-target', 'fixture-guild')
    `);
    await withFixture(async ({ sqlitePath }) => {
      await assert.rejects(
        runTargetOperation({
          sqlitePath,
          databaseUrl: process.env.DATABASE_URL,
          skipSchema: true,
          log() {},
        }),
        /target is not empty.*tournaments \(1\)/i,
      );
      const rows = await queryTarget('SELECT external_id FROM tournaments');
      assert.deepEqual(rows.rows, [{ external_id: 'existing-target' }]);
    });
  },
);

test(
  'SQLite import rolls back a primary-key conflict introduced mid-copy',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      await assert.rejects(
        runTargetOperation({
          sqlitePath,
          databaseUrl: process.env.DATABASE_URL,
          log() {},
          hooks: {
            async afterTable({ client, table }) {
              if (table === 'tournaments') {
                await client.query(
                  `INSERT INTO teams (id, game, name, slug)
                   VALUES (501, 'valorant', 'Conflict', 'conflict')`,
                );
              }
            },
          },
        }),
        /duplicate key|unique constraint/i,
      );
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM tournaments')).rows[0].count), 0);
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM teams')).rows[0].count), 0);
    });
  },
);

test(
  'SQLite import rejects source-only and target-only columns before copying',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      const sqlite = new Database(sqlitePath);
      sqlite.exec('ALTER TABLE teams ADD COLUMN unmapped_probe TEXT');
      sqlite.close();
      await assert.rejects(
        runTargetOperation({
          sqlitePath,
          databaseUrl: process.env.DATABASE_URL,
          log() {},
        }),
        /teams.*source-only.*unmapped_probe/i,
      );
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM tournaments')).rows[0].count), 0);
    });

    await resetTarget({ migrate: true });
    await queryTarget('ALTER TABLE teams ADD COLUMN required_probe TEXT NOT NULL DEFAULT \'probe\'');
    await withFixture(async ({ sqlitePath }) => {
      await assert.rejects(
        runTargetOperation({
          sqlitePath,
          databaseUrl: process.env.DATABASE_URL,
          skipSchema: true,
          log() {},
        }),
        /teams.*target-only.*required_probe/i,
      );
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM tournaments')).rows[0].count), 0);
    });
  },
);

test(
  'SQLite import transforms legacy post comment targets explicitly',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      const sqlite = new Database(sqlitePath);
      sqlite.pragma('foreign_keys = OFF');
      sqlite.exec(`
        ALTER TABLE post_comments RENAME TO post_comments_current;
        CREATE TABLE post_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER,
          parent_comment_id INTEGER,
          root_comment_id INTEGER,
          auth_user_id TEXT NOT NULL,
          discord_user_id TEXT NOT NULL,
          author_name TEXT NOT NULL DEFAULT '',
          author_avatar_url TEXT,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'visible',
          flag_reason_json TEXT,
          auto_approve_at INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          edited_at TEXT,
          deleted_at TEXT,
          deleted_by TEXT
        );
        INSERT INTO post_comments
          (id, post_id, auth_user_id, discord_user_id, author_name, body)
        SELECT id, post_id, auth_user_id, discord_user_id, author_name, body
        FROM post_comments_current;
        DROP TABLE post_comments_current;
      `);
      sqlite.close();

      await runTargetOperation({
        sqlitePath,
        databaseUrl: process.env.DATABASE_URL,
        log() {},
      });
      const result = await queryTarget(
        'SELECT post_id, target_type, target_id FROM post_comments WHERE id = 81',
      );
      assert.deepEqual(result.rows[0], {
        post_id: '71',
        target_type: 'news',
        target_id: '71',
      });
    });
  },
);

test(
  'SQLite import rolls back injected mid-copy and count-validation failures',
  { skip: !postgresEnabled },
  async () => {
    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      await assert.rejects(
        runTargetOperation({
          sqlitePath,
          databaseUrl: process.env.DATABASE_URL,
          log() {},
          hooks: {
            afterTable({ table }) {
              if (table === 'matches') throw new Error('synthetic mid-copy failure');
            },
          },
        }),
        /synthetic mid-copy failure/,
      );
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM tournaments')).rows[0].count), 0);
    });

    await resetTarget();
    await withFixture(async ({ sqlitePath }) => {
      await assert.rejects(
        runTargetOperation({
          sqlitePath,
          databaseUrl: process.env.DATABASE_URL,
          log() {},
          hooks: {
            async beforeValidation({ client }) {
              await client.query(`
                INSERT INTO tournaments (source, external_id, guild_id)
                VALUES ('liquipedia', 'count-mismatch', 'fixture-guild')
              `);
            },
          },
        }),
        /Row-count validation failed for tournaments/i,
      );
      assert.equal(Number((await queryTarget('SELECT COUNT(*) FROM tournaments')).rows[0].count), 0);
    });
  },
);
