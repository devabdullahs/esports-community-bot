import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Ensure the directory that will hold the SQLite file exists.
mkdirSync(dirname(config.db.path), { recursive: true });

export const db = new Database(config.db.path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT    NOT NULL CHECK (source IN ('pandascore','startgg','liquipedia')),
    external_id  TEXT    NOT NULL,
    game         TEXT,
    name         TEXT,
    url          TEXT,
    guild_id     TEXT    NOT NULL,
    added_by     TEXT,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, external_id, guild_id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    source         TEXT    NOT NULL,
    external_id    TEXT    NOT NULL,
    name           TEXT,
    team_a         TEXT,
    team_b         TEXT,
    logo_a         TEXT,
    logo_b         TEXT,
    score_a        INTEGER DEFAULT 0,
    score_b        INTEGER DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','running','finished')),
    scheduled_at   INTEGER,            -- unix seconds; feeds Discord <t:...> timestamps
    last_polled_at TEXT,
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_matches_status     ON matches(status);
  CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id               TEXT PRIMARY KEY,
    schedule_channel_id    TEXT,
    voice_channel_id       TEXT,
    leaderboard_channel_id TEXT,
    leaderboard_message_id TEXT,
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Lightweight migrations: add columns to existing tables when the schema grows.
function ensureColumns(table, defs) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of defs) {
    if (!have.has(name)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    }
  }
}

// EWC Club Championship tracking (one per guild).
ensureColumns('guild_settings', [
  ['cc_wiki', 'TEXT'],
  ['cc_page', 'TEXT'],
  ['cc_channel_id', 'TEXT'],
  ['cc_message_id', 'TEXT'],
  ['cc_label', 'TEXT'],
  ['audit_log_channel_id', 'TEXT'],
  ['cs_rankings_channel_id', 'TEXT'],
  ['cs_rankings_message_id', 'TEXT'],
  ['cs_rankings_region', 'TEXT'],
  ['cs_rankings_format', 'TEXT'],
  ['match_card_channel_id', 'TEXT'],
  ['match_card_message_id', 'TEXT'],
  ['ewc_predictions_channel_id', 'TEXT'],
  ['ewc_predictions_leaderboard_channel_id', 'TEXT'],
  ['ewc_predictions_leaderboard_message_id', 'TEXT'],
  ['ewc_predictions_leaderboard_season', 'TEXT'],
  ['ewc_predictions_mentions_channel_id', 'TEXT'],
  ['ewc_predictions_mentions_message_id', 'TEXT'],
  ['ewc_predictions_mentions_season', 'TEXT'],
]);

ensureColumns('matches', [
  ['logo_a', 'TEXT'],
  ['logo_b', 'TEXT'],
]);

// Per-game leaderboard boards (a guild can have one board per game, plus the combined board
// stored in guild_settings). scope here is the game slug.
db.exec(`
  CREATE TABLE IF NOT EXISTS game_leaderboards (
    guild_id   TEXT NOT NULL,
    game       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, game)
  );
`);

// Per-game voice channels (a guild can have one VC per game, plus the combined VC stored in
// guild_settings.voice_channel_id). Each channel's name reflects that game's live/next match.
db.exec(`
  CREATE TABLE IF NOT EXISTS game_voice_channels (
    guild_id   TEXT NOT NULL,
    game       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, game)
  );
`);

// Per-game match-card channels. Each board owns one Discord message per running match.
// A board game of "all" is the combined/all-games card board.
db.exec(`
  CREATE TABLE IF NOT EXISTS game_match_cards (
    guild_id   TEXT NOT NULL,
    game       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, game)
  );

  CREATE TABLE IF NOT EXISTS match_card_messages (
    guild_id   TEXT NOT NULL,
    game       TEXT NOT NULL,
    match_id   INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, game, match_id)
  );
`);

// EWC community predictions. Weekly rounds are scored from the delta between two standings
// snapshots; season rounds are scored from the final Club Championship standings.
db.exec(`
  CREATE TABLE IF NOT EXISTS ewc_prediction_weeks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id       TEXT NOT NULL,
    season         TEXT NOT NULL DEFAULT '2026',
    week_key       TEXT NOT NULL,
    label          TEXT,
    open_at        INTEGER,
    close_at       INTEGER,
    score_after    INTEGER,
    status         TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','closed','scored')),
    baseline_json  TEXT,
    final_json     TEXT,
    created_by     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    scored_at      TEXT,
    UNIQUE (guild_id, season, week_key)
  );

  CREATE TABLE IF NOT EXISTS ewc_weekly_predictions (
    guild_id       TEXT NOT NULL,
    week_id        INTEGER NOT NULL REFERENCES ewc_prediction_weeks(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL,
    picks_json     TEXT NOT NULL,
    score          INTEGER,
    details_json   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, week_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ewc_prediction_seasons (
    guild_id       TEXT NOT NULL,
    season         TEXT NOT NULL DEFAULT '2026',
    label          TEXT,
    open_at        INTEGER,
    close_at       INTEGER,
    score_after    INTEGER,
    status         TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','closed','scored')),
    top_size       INTEGER NOT NULL DEFAULT 10,
    final_json     TEXT,
    created_by     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    scored_at      TEXT,
    PRIMARY KEY (guild_id, season)
  );

  CREATE TABLE IF NOT EXISTS ewc_season_predictions (
    guild_id       TEXT NOT NULL,
    season         TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    picks_json     TEXT NOT NULL,
    score          INTEGER,
    details_json   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, season, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ewc_weekly_predictions_week
    ON ewc_weekly_predictions(week_id, score DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_season_predictions_season
    ON ewc_season_predictions(guild_id, season, score DESC);
`);

ensureColumns('ewc_prediction_weeks', [['score_after', 'INTEGER']]);
ensureColumns('ewc_prediction_seasons', [['score_after', 'INTEGER']]);

// Canonicalize old game keys after slug changes. Keep this tiny and explicit so existing
// per-game boards continue to work without creating duplicate alias rows later.
function canonicalizeGameKey(table, oldGame, newGame) {
  db.prepare(`DELETE FROM ${table} WHERE game = ? AND EXISTS (SELECT 1 FROM ${table} WHERE game = ?)`).run(oldGame, newGame);
  db.prepare(`UPDATE ${table} SET game = ? WHERE game = ?`).run(newGame, oldGame);
}

for (const table of ['game_leaderboards', 'game_voice_channels', 'game_match_cards', 'match_card_messages']) {
  canonicalizeGameKey(table, 'teamfighttactics', 'tft');
}
db.prepare(`UPDATE tournaments SET game = ? WHERE game = ?`).run('tft', 'teamfighttactics');

logger.info(`SQLite ready at ${config.db.path}`);

export function closeDb() {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
