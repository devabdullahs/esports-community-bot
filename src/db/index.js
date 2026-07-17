import { logger } from '../lib/logger.js';
import { db } from './connection.js';
export { db, closeDb } from './connection.js';

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
    ewc          INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    archived_at  INTEGER,
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
    stream_platform TEXT,              -- official per-match broadcast stream (Liquipedia)
    stream_url      TEXT,              -- Liquipedia Special:Stream link (resolves the real channel)
    last_polled_at TEXT,
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_matches_status     ON matches(status);
  CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);

  CREATE TABLE IF NOT EXISTS match_details (
    match_id     INTEGER NOT NULL PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    source_page  TEXT    NOT NULL,
    game         TEXT    NOT NULL,
    payload_json TEXT    NOT NULL,
    fetched_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game           TEXT,
    -- Nullable: PandaScore-sourced rows carry their id; Liquipedia-only rows
    -- (battle-royale games, TFT, ... - games PandaScore does not cover) don't.
    pandascore_id  INTEGER UNIQUE,
    name           TEXT NOT NULL,
    slug           TEXT,
    acronym        TEXT,
    nationality    TEXT,
    image_url      TEXT,
    location       TEXT,
    modified_at    TEXT,
    raw_json       TEXT,
    liquipedia_url       TEXT,
    liquipedia_raw       TEXT,
    liquipedia_facts     TEXT,
    liquipedia_parsed_at TEXT,
    last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_teams_game_name ON teams(game, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_game_slug ON teams(game, slug) WHERE slug IS NOT NULL;

  CREATE TABLE IF NOT EXISTS players (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    game                        TEXT,
    pandascore_id               INTEGER UNIQUE,
    name                        TEXT NOT NULL,
    slug                        TEXT,
    first_name                  TEXT,
    last_name                   TEXT,
    nationality                 TEXT,
    image_url                   TEXT,
    role                        TEXT,
    current_team_id             INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    current_team_pandascore_id  INTEGER,
    current_team_name           TEXT,
    current_team_verified_at    TEXT,
    modified_at                 TEXT,
    raw_json                    TEXT,
    liquipedia_url              TEXT,
    liquipedia_raw              TEXT,
    liquipedia_facts            TEXT,
    liquipedia_parsed_at        TEXT,
    last_seen_at                TEXT NOT NULL DEFAULT (datetime('now')),
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_players_game_name ON players(game, name);
  CREATE INDEX IF NOT EXISTS idx_players_current_team ON players(current_team_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_game_slug ON players(game, slug) WHERE slug IS NOT NULL;

  CREATE TABLE IF NOT EXISTS mvp_vote_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    vote_date  TEXT    NOT NULL UNIQUE,
    opens_at   INTEGER NOT NULL,
    closes_at  INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (closes_at > opens_at)
  );

  CREATE TABLE IF NOT EXISTS mvp_vote_nominees (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        INTEGER NOT NULL REFERENCES mvp_vote_sessions(id) ON DELETE CASCADE,
    player_id         INTEGER REFERENCES players(id) ON DELETE SET NULL,
    source_match_id   INTEGER REFERENCES matches(id) ON DELETE SET NULL,
    nominee_key       TEXT    NOT NULL,
    display_name      TEXT    NOT NULL,
    team_name         TEXT,
    game              TEXT    NOT NULL,
    image_url         TEXT,
    performance_score REAL    NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (session_id, nominee_key),
    UNIQUE (session_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_mvp_nominees_player ON mvp_vote_nominees(player_id);

  CREATE TABLE IF NOT EXISTS mvp_votes (
    session_id     INTEGER NOT NULL REFERENCES mvp_vote_sessions(id) ON DELETE CASCADE,
    nominee_id     INTEGER NOT NULL,
    discord_user_id TEXT   NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, discord_user_id),
    FOREIGN KEY (session_id, nominee_id)
      REFERENCES mvp_vote_nominees(session_id, id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_mvp_votes_nominee ON mvp_votes(session_id, nominee_id);

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

// SQLite cannot alter a CHECK constraint in place. The temporary table is
// copied before the old parent is dropped, so child foreign-key definitions
// continue to refer to ewc_news_posts after the replacement is renamed.
function migrateEwcNewsPostStatusConstraint() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ewc_news_posts'")
    .get();
  const statusDefinition = row?.sql?.match(/status\s+[\s\S]*?CHECK\s*\([^)]*\)/i)?.[0] || '';
  if (!row?.sql || /scheduled/i.test(statusDefinition)) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE ewc_news_posts_scheduled (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        game_slug            TEXT,
        media_slug           TEXT,
        locale               TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
        content_mode         TEXT NOT NULL DEFAULT 'shared' CHECK (content_mode IN ('shared','translated')),
        default_locale       TEXT NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en','ar')),
        title                TEXT NOT NULL,
        summary              TEXT NOT NULL DEFAULT '',
        body                 TEXT NOT NULL DEFAULT '',
        status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
        author_discord_id    TEXT,
        author_name          TEXT,
        cover_image_url      TEXT,
        cover_placement      TEXT,
        ewc                  INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
        published_at         TEXT,
        scheduled_publish_at TEXT
      );
      INSERT INTO ewc_news_posts_scheduled
        (id, game_slug, media_slug, locale, content_mode, default_locale, title, summary, body,
         status, author_discord_id, author_name, cover_image_url, cover_placement, ewc,
         created_at, updated_at, published_at, scheduled_publish_at)
      SELECT id, game_slug, media_slug, locale, content_mode, default_locale, title, summary, body,
             status, author_discord_id, author_name, cover_image_url, cover_placement, ewc,
             created_at, updated_at, published_at, scheduled_publish_at
        FROM ewc_news_posts;
      DROP TABLE ewc_news_posts;
      ALTER TABLE ewc_news_posts_scheduled RENAME TO ewc_news_posts;
      CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_game_status
        ON ewc_news_posts(game_slug, status, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_status_updated
        ON ewc_news_posts(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_media_status
        ON ewc_news_posts(media_slug, status, published_at DESC);
    `);
    db.exec('COMMIT');
    logger.info('[db] expanded ewc_news_posts.status to include scheduled');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.pragma('foreign_keys = ON');
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
  ['costream_announce_channel_id', 'TEXT'],
  ['ewc_predictions_leaderboard_channel_id', 'TEXT'],
  ['ewc_predictions_leaderboard_message_id', 'TEXT'],
  ['ewc_predictions_leaderboard_season', 'TEXT'],
  ['ewc_predictions_mentions_channel_id', 'TEXT'],
  ['ewc_predictions_mentions_message_id', 'TEXT'],
  ['ewc_predictions_mentions_season', 'TEXT'],
  ['ewc_news_channel_id', 'TEXT'],
  ['costream_announce_role_id', 'TEXT'],
]);

ensureColumns('matches', [
  ['logo_a', 'TEXT'],
  ['logo_b', 'TEXT'],
  // Official per-match broadcast stream (parsed from Liquipedia's per-match
  // Special:Stream link). Present only while the match is being streamed.
  ['stream_platform', 'TEXT'],
  ['stream_url', 'TEXT'],
]);

ensureColumns('teams', [
  ['game', 'TEXT'],
  ['slug', 'TEXT'],
  ['acronym', 'TEXT'],
  ['nationality', 'TEXT'],
  ['image_url', 'TEXT'],
  ['location', 'TEXT'],
  ['modified_at', 'TEXT'],
  ['raw_json', 'TEXT'],
  ['liquipedia_url', 'TEXT'],
  ['liquipedia_raw', 'TEXT'],
  ['liquipedia_facts', 'TEXT'],
  ['liquipedia_parsed_at', 'TEXT'],
  ['last_seen_at', 'TEXT'],
  ['created_at', 'TEXT'],
  ['updated_at', 'TEXT'],
]);

ensureColumns('players', [
  ['game', 'TEXT'],
  ['slug', 'TEXT'],
  ['first_name', 'TEXT'],
  ['last_name', 'TEXT'],
  ['nationality', 'TEXT'],
  ['image_url', 'TEXT'],
  ['role', 'TEXT'],
  ['current_team_id', 'INTEGER REFERENCES teams(id) ON DELETE SET NULL'],
  ['current_team_pandascore_id', 'INTEGER'],
  ['current_team_name', 'TEXT'],
  // Set when a successfully parsed Liquipedia roster confirmed the player's
  // team. While present, PandaScore syncs must not overwrite current_team_*.
  ['current_team_verified_at', 'TEXT'],
  ['modified_at', 'TEXT'],
  ['raw_json', 'TEXT'],
  ['liquipedia_url', 'TEXT'],
  ['liquipedia_raw', 'TEXT'],
  ['liquipedia_facts', 'TEXT'],
  ['liquipedia_parsed_at', 'TEXT'],
  ['last_seen_at', 'TEXT'],
  ['created_at', 'TEXT'],
  ['updated_at', 'TEXT'],
]);

ensureColumns('tournaments', [
  ['archived_at', 'INTEGER'],
  ['ewc', 'INTEGER NOT NULL DEFAULT 0'],
]);

// Durable schedule-sync outcomes. This stores only coarse operational categories
// so public projections never need provider messages, URLs, or response payloads.
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_sync_health (
    tournament_id          INTEGER PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
    source                 TEXT NOT NULL CHECK (source IN ('liquipedia','startgg','pandascore')),
    last_attempt_at        INTEGER,
    last_success_at        INTEGER,
    last_failure_at        INTEGER,
    last_failure_category  TEXT CHECK (last_failure_category IN ('rate_limit','auth','timeout','network','parse','unknown')),
    consecutive_failures   INTEGER NOT NULL DEFAULT 0,
    last_item_count        INTEGER,
    updated_at             INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tournament_sync_health_source
    ON tournament_sync_health(source);
  CREATE INDEX IF NOT EXISTS idx_tournament_sync_health_last_success
    ON tournament_sync_health(last_success_at DESC);
`);

// Migration: pandascore_id used to be NOT NULL; Liquipedia-only entities (games
// PandaScore doesn't cover: battle royale, TFT, ...) need it nullable. SQLite
// can't relax a NOT NULL in place, so rebuild the table once on old dev DBs.
// FKs are toggled off for the swap (players.current_team_id references teams).
function relaxNotNull(table) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  const col = info.find((c) => c.name === 'pandascore_id');
  if (!col || !col.notnull) return;
  const columns = info.map((c) => c.name).join(', ');
  const create = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table)?.sql;
  if (!create) return;
  const relaxed = create
    .replace(new RegExp(`\\b${table}\\b`), `${table}_new`)
    .replace(/pandascore_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i, 'pandascore_id  INTEGER UNIQUE');
  const indexes = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`)
    .all(table)
    .map((row) => row.sql);
  db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(relaxed);
    db.exec(`INSERT INTO ${table}_new (${columns}) SELECT ${columns} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
    for (const sql of indexes) db.exec(sql);
    db.exec('COMMIT');
    logger.info(`[db] relaxed ${table}.pandascore_id NOT NULL (rebuild migration)`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
relaxNotNull('teams');
relaxNotNull('players');

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
    start_at       INTEGER,
    end_at         INTEGER,
    open_at        INTEGER,
    close_at       INTEGER,
    score_after    INTEGER,
    status         TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','closed','scored')),
    baseline_json  TEXT,
    final_json     TEXT,
    games_json     TEXT,
    results_json   TEXT,
    created_by     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    scored_at      TEXT,
    open_announced_at TEXT,
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

  CREATE TABLE IF NOT EXISTS ewc_prediction_reminders (
    guild_id          TEXT NOT NULL,
    week_id           INTEGER NOT NULL REFERENCES ewc_prediction_weeks(id) ON DELETE CASCADE,
    game_key          TEXT NOT NULL,
    kind              TEXT NOT NULL,
    sent_at           TEXT,
    claim_token       TEXT,
    claim_expires_at  INTEGER,
    attempts          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, week_id, game_key, kind)
  );

  -- Durable requests from the dashboard to the bot-owned prediction operations
  -- consumer. JSON is deliberately bounded/sanitized by the DB helper: never
  -- put source payloads, sessions, or Discord objects in this process boundary.
  CREATE TABLE IF NOT EXISTS ewc_prediction_operations (
    id                   TEXT PRIMARY KEY,
    guild_id             TEXT NOT NULL,
    season               TEXT NOT NULL,
    operation            TEXT NOT NULL,
    args_json            TEXT NOT NULL,
    status               TEXT NOT NULL,
    idempotency_key      TEXT NOT NULL UNIQUE,
    requested_actor_id   TEXT,
    requested_actor_type TEXT NOT NULL,
    requested_at         TEXT NOT NULL,
    lease_token          TEXT,
    lease_expires_at     INTEGER,
    attempts             INTEGER NOT NULL DEFAULT 0,
    started_at           TEXT,
    completed_at         TEXT,
    result_json          TEXT,
    error_text           TEXT
  );

  CREATE TABLE IF NOT EXISTS ewc_prediction_operation_health (
    guild_id        TEXT NOT NULL,
    season          TEXT NOT NULL,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error      TEXT,
    PRIMARY KEY (guild_id, season)
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

  -- Private, member-scoped views of the official prediction leaderboard.
  -- Invite codes are high-entropy random values and are only exposed to owners.
  CREATE TABLE IF NOT EXISTS ewc_prediction_leagues (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL,
    season          TEXT NOT NULL,
    name            TEXT NOT NULL,
    owner_user_id   TEXT NOT NULL,
    invite_code     TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS ewc_prediction_league_members (
    league_id       TEXT NOT NULL REFERENCES ewc_prediction_leagues(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (league_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ewc_club_championship_snapshots (
    season          TEXT PRIMARY KEY,
    source_url      TEXT NOT NULL,
    standings_json  TEXT NOT NULL,
    prizepool_json  TEXT NOT NULL DEFAULT '[]',
    clubs_source_url TEXT,
    clubs_json       TEXT,
    clubs_fetched_at TEXT,
    fetched_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ewc_club_championship_snapshot_history (
    season          TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,
    standings_json  TEXT NOT NULL,
    PRIMARY KEY (season, fetched_at)
  );

  CREATE INDEX IF NOT EXISTS idx_ewc_weekly_predictions_week
    ON ewc_weekly_predictions(week_id, score DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_prediction_reminders_claim
    ON ewc_prediction_reminders(sent_at, claim_expires_at);
  CREATE INDEX IF NOT EXISTS idx_ewc_prediction_operations_claim
    ON ewc_prediction_operations(status, lease_expires_at, requested_at);
  CREATE INDEX IF NOT EXISTS idx_ewc_season_predictions_season
    ON ewc_season_predictions(guild_id, season, score DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_prediction_leagues_scope
    ON ewc_prediction_leagues(guild_id, season, archived_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_prediction_league_members_user
    ON ewc_prediction_league_members(user_id, league_id);
  CREATE INDEX IF NOT EXISTS idx_ewc_club_championship_snapshots_fetched
    ON ewc_club_championship_snapshots(fetched_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_club_championship_snapshot_history_season_fetched
    ON ewc_club_championship_snapshot_history(season, fetched_at DESC);

  CREATE TABLE IF NOT EXISTS ewc_profile_links (
    auth_user_id     TEXT NOT NULL,
    discord_user_id  TEXT PRIMARY KEY,
    guild_id         TEXT NOT NULL,
    season           TEXT NOT NULL DEFAULT '2026',
    public_identity_enabled    INTEGER NOT NULL DEFAULT 1,
    public_display_name        TEXT,
    public_avatar_url          TEXT,
    public_avatar_token        TEXT UNIQUE,
    public_identity_updated_at TEXT,
    last_synced_at   TEXT,
    last_sync_error  TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ewc_news_posts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    -- A post is owned by EITHER a game (game_slug) OR a media channel (media_slug).
    -- game_slug is nullable so media posts can omit it (or use it as an optional tag).
    game_slug         TEXT,
    media_slug        TEXT,
    locale            TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
    content_mode      TEXT NOT NULL DEFAULT 'shared' CHECK (content_mode IN ('shared','translated')),
    default_locale    TEXT NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en','ar')),
    title             TEXT NOT NULL,
    summary           TEXT NOT NULL DEFAULT '',
    body              TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published')),
    author_discord_id TEXT,
    author_name       TEXT,
    cover_image_url   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    published_at      TEXT,
    scheduled_publish_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_game_status
    ON ewc_news_posts(game_slug, status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_status_updated
    ON ewc_news_posts(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ewc_news_post_translations (
    post_id    INTEGER NOT NULL REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
    locale     TEXT NOT NULL CHECK (locale IN ('en','ar')),
    title      TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, locale)
  );

  -- A post can credit multiple authors; name/avatar are snapshotted at save time
  -- (avatar from the author's Better Auth login, null if they never signed in).
  CREATE TABLE IF NOT EXISTS ewc_news_post_authors (
    post_id    INTEGER NOT NULL REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
    discord_id TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, discord_id)
  );

  -- Side table mapping a published news post to the Discord message that announces it.
  -- ON DELETE CASCADE so deleting a post auto-cleans this row (foreign_keys pragma is ON).
  CREATE TABLE IF NOT EXISTS ewc_news_discord_posts (
    post_id    INTEGER PRIMARY KEY REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
    guild_id   TEXT,
    channel_id TEXT,
    message_id TEXT,
    posted_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ewc_games (
    slug               TEXT PRIMARY KEY,
    title_json         TEXT NOT NULL,
    description_json   TEXT NOT NULL,
    status_json        TEXT NOT NULL,
    owner_json         TEXT NOT NULL,
    focus_json         TEXT NOT NULL DEFAULT '[]',
    discord_channel_id TEXT,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ewc_games_sort ON ewc_games(sort_order, slug);

  CREATE TABLE IF NOT EXISTS ewc_media_channels (
    slug             TEXT PRIMARY KEY,
    name_json        TEXT NOT NULL,
    description_json TEXT NOT NULL,
    logo_url         TEXT,
    links_json       TEXT NOT NULL DEFAULT '[]',
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ewc_media_channels_sort ON ewc_media_channels(sort_order, slug);

  -- Side table mapping a media channel to the Discord message that announces it.
  -- One row per channel (single-guild). No REFERENCES clause: media channels are
  -- removed via an explicit transactional cleanup (deleteEwcMediaChannel), mirroring
  -- the other scope tables, so we delete the row there too.
  CREATE TABLE IF NOT EXISTS ewc_media_discord_posts (
    slug       TEXT PRIMARY KEY,
    guild_id   TEXT,
    channel_id TEXT,
    message_id TEXT,
    posted_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ewc_rate_limits (
    key           TEXT PRIMARY KEY,
    window_start  INTEGER NOT NULL,
    amount        INTEGER NOT NULL
  );

  -- Community comments on durable targets. One-level threads: a reply's parent/root
  -- both point at the ROOT comment (replies to replies are re-targeted to the
  -- root in createComment). Soft delete (status='deleted') keeps reply threads
  -- intact; a hard-deleted news post cascades its comments away. post_id is
  -- retained for that news FK while target_type/target_id identify every target.
  CREATE TABLE IF NOT EXISTS post_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id           INTEGER REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
    target_type       TEXT    NOT NULL DEFAULT 'news' CHECK (target_type IN ('news','match')),
    target_id         INTEGER NOT NULL,
    parent_comment_id INTEGER REFERENCES post_comments(id) ON DELETE SET NULL,
    root_comment_id   INTEGER REFERENCES post_comments(id) ON DELETE SET NULL,
    auth_user_id      TEXT NOT NULL,
    discord_user_id   TEXT NOT NULL,
    author_name       TEXT NOT NULL DEFAULT '',
    author_avatar_url TEXT,
    body              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'visible'
                      CHECK (status IN ('visible','pending','hidden','rejected','deleted')),
    flag_reason_json  TEXT,
    auto_approve_at   INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at         TEXT,
    deleted_at        TEXT,
    deleted_by        TEXT,
    CHECK (
      (target_type = 'news' AND post_id = target_id)
      OR (target_type = 'match' AND post_id IS NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id         INTEGER NOT NULL REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, discord_user_id)
  );

  CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id      INTEGER NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    discord_user_id TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (comment_id, discord_user_id)
  );

  CREATE TABLE IF NOT EXISTS comment_moderation_actions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id           INTEGER NOT NULL,
    moderator_discord_id TEXT NOT NULL,
    moderator_name       TEXT,
    action               TEXT NOT NULL,
    reason               TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comment_mod_actions ON comment_moderation_actions(comment_id, created_at);

  -- Global and target-specific literal watchlist rules. Display text remains
  -- untouched while phrase_normalized enforces case-insensitive uniqueness.
  CREATE TABLE IF NOT EXISTS comment_keyword_rules (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase            TEXT NOT NULL CHECK (length(phrase) BETWEEN 1 AND 160),
    phrase_normalized TEXT NOT NULL CHECK (length(phrase_normalized) BETWEEN 1 AND 160),
    locale            TEXT NOT NULL DEFAULT 'all' CHECK (locale IN ('all','en','ar')),
    scope             TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','news','match')),
    action            TEXT NOT NULL CHECK (action IN ('hold','flag')),
    enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_by        TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (phrase_normalized, locale, scope)
  );
  CREATE INDEX IF NOT EXISTS idx_comment_keyword_rules_enabled
    ON comment_keyword_rules(enabled, scope, locale, id);

  CREATE TABLE IF NOT EXISTS comment_reports (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id            INTEGER NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    reporter_discord_id   TEXT NOT NULL,
    reporter_auth_user_id TEXT,
    reason                TEXT NOT NULL
                          CHECK (reason IN ('spam','harassment','hate','sexual','other')),
    detail                TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','resolved','dismissed')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (comment_id, reporter_discord_id)
  );
  CREATE INDEX IF NOT EXISTS idx_comment_reports_comment ON comment_reports(comment_id, status);
  CREATE INDEX IF NOT EXISTS idx_comment_reports_open ON comment_reports(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS community_user_blocks (
    discord_user_id TEXT PRIMARY KEY,
    blocked_by      TEXT NOT NULL,
    blocked_by_name TEXT,
    reason          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_inquiries (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_name TEXT NOT NULL,
    contact_name      TEXT NOT NULL,
    email             TEXT NOT NULL,
    website_url       TEXT,
    interest          TEXT NOT NULL CHECK (interest IN ('open_source_partner','prediction_partner','event_prize_later','other')),
    message           TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','approved','declined','converted')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_partner_inquiries_status
    ON partner_inquiries(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS partners (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    logo_url    TEXT,
    website_url TEXT,
    summary     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_partners_status
    ON partners(status, name);

  CREATE TABLE IF NOT EXISTS partner_campaigns (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id        INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('homepage','footer','predictions','leaderboard','tournament')),
    target            TEXT NOT NULL DEFAULT '',
    title             TEXT NOT NULL DEFAULT '',
    note              TEXT NOT NULL DEFAULT '',
    start_at          INTEGER,
    end_at            INTEGER,
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
    payment_method    TEXT NOT NULL DEFAULT 'github_sponsors' CHECK (payment_method IN ('github_sponsors','bank_transfer','paypal','other','waived')),
    payment_status    TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid')),
    payment_reference TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_partner_campaigns_active
    ON partner_campaigns(kind, target, status, start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_partner_campaigns_partner
    ON partner_campaigns(partner_id);

  CREATE TABLE IF NOT EXISTS ewc_admins (
    discord_id   TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ewc_admin_game_scopes (
    discord_id TEXT NOT NULL,
    game_slug  TEXT NOT NULL,
    PRIMARY KEY (discord_id, game_slug)
  );

  CREATE TABLE IF NOT EXISTS ewc_admin_media_scopes (
    discord_id TEXT NOT NULL,
    media_slug TEXT NOT NULL,
    PRIMARY KEY (discord_id, media_slug)
  );

  CREATE TABLE IF NOT EXISTS ewc_admin_audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id     TEXT NOT NULL,
    actor_name   TEXT,
    action       TEXT NOT NULL,
    target       TEXT,
    details      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_created
    ON ewc_admin_audit_log(created_at DESC);

  CREATE TABLE IF NOT EXISTS ewc_mcp_keys (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash         TEXT NOT NULL UNIQUE,
    key_prefix       TEXT NOT NULL,
    label            TEXT NOT NULL DEFAULT '',
    owner_discord_id TEXT NOT NULL,
    owner_name       TEXT,
    tools_json       TEXT NOT NULL DEFAULT '[]',
    game_scopes_json TEXT NOT NULL DEFAULT '[]',
    media_scopes_json TEXT NOT NULL DEFAULT '[]',
    expires_at       INTEGER,
    revoked_at       TEXT,
    last_used_at     TEXT,
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ewc_mcp_keys_owner
    ON ewc_mcp_keys(owner_discord_id, revoked_at);

  CREATE TABLE IF NOT EXISTS ewc_mcp_write_receipts (
    key_id          INTEGER NOT NULL,
    tool_name       TEXT    NOT NULL,
    idempotency_key TEXT    NOT NULL,
    -- Canonical digest of the request arguments: reusing an idempotency key
    -- with a DIFFERENT payload is rejected instead of replayed.
    request_digest  TEXT,
    result_json     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    PRIMARY KEY (key_id, tool_name, idempotency_key)
  );

  -- Admin-curated live-stream / co-stream channels (Twitch, Kick, YouTube, SOOP).
  -- A channel is attached at one SCOPE: 'game' (every match of game_slug),
  -- 'team' (every match a team plays, keyed by normalized team_key), 'match'
  -- (one match by external id), or 'ewc' (the official EWC co-stream list).
  -- Scope-key columns default to '' (not NULL) so the UNIQUE constraint behaves
  -- identically on SQLite and Postgres. Live status lives in a separate table.
  CREATE TABLE IF NOT EXISTS stream_channels (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    platform          TEXT NOT NULL CHECK (platform IN ('twitch','kick','youtube','soop')),
    handle            TEXT NOT NULL,
    label             TEXT NOT NULL DEFAULT '',
    scope             TEXT NOT NULL CHECK (scope IN ('game','team','match','ewc')),
    creator_key       TEXT NOT NULL DEFAULT '',
    game_slug         TEXT NOT NULL DEFAULT '',
    game_slugs        TEXT NOT NULL DEFAULT '[]',
    team_key          TEXT NOT NULL DEFAULT '',
    match_external_id TEXT NOT NULL DEFAULT '',
    language          TEXT NOT NULL DEFAULT '',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_default        INTEGER NOT NULL DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    added_by          TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (platform, handle, scope, game_slug, team_key, match_external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_stream_channels_scope ON stream_channels(scope, active);
  CREATE INDEX IF NOT EXISTS idx_stream_channels_game  ON stream_channels(game_slug, active);
  CREATE INDEX IF NOT EXISTS idx_stream_channels_team  ON stream_channels(team_key, active);

  -- Live status per platform+handle, refreshed by the stream-status poller. Keyed by
  -- platform+handle (NOT channel id) so multiple channel rows sharing a handle share
  -- one status row. is_live 0/1; timestamps are unix seconds.
  CREATE TABLE IF NOT EXISTS stream_channel_status (
    platform      TEXT    NOT NULL,
    handle        TEXT    NOT NULL,
    is_live       INTEGER NOT NULL DEFAULT 0,
    title         TEXT,
    viewer_count  INTEGER,
    category      TEXT,
    thumbnail_url TEXT,
    video_id      TEXT,
    started_at    INTEGER,
    checked_at    INTEGER,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (platform, handle)
  );
  CREATE INDEX IF NOT EXISTS idx_stream_status_live ON stream_channel_status(is_live);

  -- Persistent creator-level go-live cooldown. This prevents duplicate Discord
  -- announcements when the same streamer is live on multiple platforms and one
  -- platform status arrives later or the bot restarts between polls.
  CREATE TABLE IF NOT EXISTS stream_creator_announce_state (
    creator_key     TEXT PRIMARY KEY,
    announced_at    INTEGER NOT NULL,
    platform        TEXT,
    handle          TEXT,
    title           TEXT,
    live_started_at INTEGER,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

ensureColumns('ewc_prediction_weeks', [
  ['score_after', 'INTEGER'],
  ['start_at', 'INTEGER'],
  ['end_at', 'INTEGER'],
  ['games_json', 'TEXT'],
  ['results_json', 'TEXT'],
  ['open_announced_at', 'TEXT'],
]);
ensureColumns('ewc_prediction_seasons', [['score_after', 'INTEGER'], ['best_weeks', 'INTEGER']]);
ensureColumns('ewc_club_championship_snapshots', [
  ['clubs_source_url', 'TEXT'],
  ['clubs_json', 'TEXT'],
  ['clubs_fetched_at', 'TEXT'],
]);
ensureColumns('ewc_profile_links', [
  ['public_identity_enabled', 'INTEGER NOT NULL DEFAULT 1'],
  ['public_display_name', 'TEXT'],
  ['public_avatar_url', 'TEXT'],
  ['public_avatar_token', 'TEXT'],
  ['public_identity_updated_at', 'TEXT'],
]);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ewc_profile_links_public_avatar_token ON ewc_profile_links(public_avatar_token)');

db.exec(`
  CREATE TABLE IF NOT EXISTS ewc_public_predictor_identities (
    discord_user_id TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    avatar_token    TEXT UNIQUE,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// SQLite cannot relax post_comments.post_id from NOT NULL in place. Rebuild
// only legacy/partial tables, preserving ids so every existing reply, like,
// report, and moderation action keeps pointing at the same comment row.
function ensurePostCommentTargetSchema() {
  const columns = db.prepare('PRAGMA table_info(post_comments)').all();
  const names = new Set(columns.map((column) => column.name));
  const postId = columns.find((column) => column.name === 'post_id');
  const needsRebuild = !names.has('target_type') || !names.has('target_id') || postId?.notnull === 1;

  if (needsRebuild) {
    const value = (name, fallback) => (names.has(name) ? name : fallback);
    const oldPostId = value('post_id', 'NULL');
    const oldTargetType = names.has('target_type')
      ? "CASE WHEN target_type IN ('news','match') THEN target_type ELSE 'news' END"
      : "'news'";
    const oldTargetId = names.has('target_id') ? `COALESCE(target_id, ${oldPostId})` : oldPostId;

    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        DROP TRIGGER IF EXISTS delete_match_comments;
        DROP TABLE IF EXISTS post_comments_target_migration;
        CREATE TABLE post_comments_target_migration (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id           INTEGER REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
          target_type       TEXT    NOT NULL DEFAULT 'news' CHECK (target_type IN ('news','match')),
          target_id         INTEGER NOT NULL,
          parent_comment_id INTEGER REFERENCES post_comments_target_migration(id) ON DELETE SET NULL,
          root_comment_id   INTEGER REFERENCES post_comments_target_migration(id) ON DELETE SET NULL,
          auth_user_id      TEXT NOT NULL,
          discord_user_id   TEXT NOT NULL,
          author_name       TEXT NOT NULL DEFAULT '',
          author_avatar_url TEXT,
          body              TEXT NOT NULL,
          status            TEXT NOT NULL DEFAULT 'visible'
                            CHECK (status IN ('visible','pending','hidden','rejected','deleted')),
          flag_reason_json  TEXT,
          auto_approve_at   INTEGER,
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
          edited_at         TEXT,
          deleted_at        TEXT,
          deleted_by        TEXT,
          CHECK (
            (target_type = 'news' AND post_id = target_id)
            OR (target_type = 'match' AND post_id IS NULL)
          )
        );
        INSERT INTO post_comments_target_migration
          (id, post_id, target_type, target_id, parent_comment_id, root_comment_id,
           auth_user_id, discord_user_id, author_name, author_avatar_url, body,
           status, flag_reason_json, auto_approve_at, created_at, updated_at,
           edited_at, deleted_at, deleted_by)
        SELECT ${value('id', 'NULL')}, ${oldPostId}, ${oldTargetType}, ${oldTargetId},
               ${value('parent_comment_id', 'NULL')}, ${value('root_comment_id', 'NULL')},
               ${value('auth_user_id', "''")}, ${value('discord_user_id', "''")},
               ${value('author_name', "''")}, ${value('author_avatar_url', 'NULL')}, ${value('body', "''")},
               ${value('status', "'visible'")}, ${value('flag_reason_json', 'NULL')}, ${value('auto_approve_at', 'NULL')},
               ${value('created_at', "datetime('now')")}, ${value('updated_at', "datetime('now')")},
               ${value('edited_at', 'NULL')}, ${value('deleted_at', 'NULL')}, ${value('deleted_by', 'NULL')}
          FROM post_comments;
        DROP TABLE post_comments;
        ALTER TABLE post_comments_target_migration RENAME TO post_comments;
        COMMIT;
      `);
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // The migration did not reach BEGIN; surface the original error below.
      }
      throw error;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_post_comments_target
      ON post_comments(target_type, target_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_post_comments_target_root
      ON post_comments(target_type, target_id, root_comment_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_post_comments_autoapprove
      ON post_comments(status, auto_approve_at);
    CREATE INDEX IF NOT EXISTS idx_post_comments_moderation
      ON post_comments(status, created_at, id);
    CREATE TRIGGER IF NOT EXISTS delete_match_comments
      AFTER DELETE ON matches
      BEGIN
        DELETE FROM post_comments WHERE target_type = 'match' AND target_id = OLD.id;
      END;
  `);
}

ensurePostCommentTargetSchema();
ensureColumns('stream_channels', [
  ['creator_key', "TEXT NOT NULL DEFAULT ''"],
  ['game_slugs', "TEXT NOT NULL DEFAULT '[]'"],
  ['is_default', 'INTEGER NOT NULL DEFAULT 0'],
]);
// Live VIDEO id (YouTube): the embed needs it — youtube.com/embed/<video_id>.
ensureColumns('stream_channel_status', [['video_id', 'TEXT']]);
db.exec('CREATE INDEX IF NOT EXISTS idx_stream_channels_creator ON stream_channels(creator_key, active)');
ensureColumns('ewc_news_posts', [
  ['content_mode', "TEXT NOT NULL DEFAULT 'shared' CHECK (content_mode IN ('shared','translated'))"],
  ['default_locale', "TEXT NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en','ar'))"],
  ['author_name', 'TEXT'],
  // Where the cover image renders on the public article: 'top' (default, above body),
  // 'bottom' (after the body), or 'card-only' (hidden inside the article, still shown on cards).
  ['cover_placement', 'TEXT'],
  // Admin-set tag: 1 = part of the Esports World Cup (surfaced on the EWC news page).
  ['ewc', 'INTEGER NOT NULL DEFAULT 0'],
  // Media-channel ownership: when set, the post belongs to a media channel (game_slug
  // becomes an optional related-game tag). NULL = a normal game post.
  ['media_slug', 'TEXT'],
  // UTC timestamp used only while status is scheduled.
  ['scheduled_publish_at', 'TEXT'],
]);
migrateEwcNewsPostStatusConstraint();
// Must run AFTER the media_slug ensureColumns above: on a DB created before the
// media feature the table exists without the column, so creating this index in
// the main schema exec would fail the whole boot ("no such column: media_slug").
db.exec(`CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_media_status
  ON ewc_news_posts(media_slug, status, published_at DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_scheduled_publish
  ON ewc_news_posts(status, scheduled_publish_at)`);
// Per-game Discord news channel (nullable; falls back to the guild-level news channel).
ensureColumns('ewc_games', [['discord_channel_id', 'TEXT']]);
// Media channels: optional Discord channel to auto-announce the entry to, and an
// optional related game (display tag; also used to resolve a fallback channel).
ensureColumns('ewc_media_channels', [
  ['discord_channel_id', 'TEXT'],
  ['game_slug', 'TEXT'],
]);

db.exec(`
  UPDATE ewc_news_posts
  SET default_locale = CASE WHEN locale = 'ar' THEN 'ar' ELSE 'en' END
  WHERE default_locale NOT IN ('en', 'ar') OR default_locale IS NULL;

  UPDATE ewc_news_posts
  SET content_mode = 'shared'
  WHERE content_mode NOT IN ('shared', 'translated') OR content_mode IS NULL;

  INSERT OR IGNORE INTO ewc_news_post_translations
    (post_id, locale, title, summary, body, created_at, updated_at)
  SELECT
    id,
    CASE WHEN locale = 'ar' THEN 'ar' ELSE 'en' END,
    title,
    summary,
    body,
    created_at,
    updated_at
  FROM ewc_news_posts;
`);

// Standings for tournaments whose Liquipedia format has no head-to-head matches
// (battle-royale events, TFT groups): one row per team per section, replaced
// wholesale on each refresh. points/extra are display text (BR total points,
// or group match-score + game-score).
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_standings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    section       TEXT NOT NULL DEFAULT '',
    section_order INTEGER NOT NULL DEFAULT 0,
    rank          INTEGER NOT NULL,
    team          TEXT NOT NULL,
    logo          TEXT,
    points        TEXT NOT NULL DEFAULT '',
    extra         TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tournament_standings_tournament
    ON tournament_standings(tournament_id, section_order, rank);
`);

ensureColumns('tournament_standings', [['section_order', 'INTEGER NOT NULL DEFAULT 0']]);
// Replay-safety digest for MCP write receipts (security hardening).
ensureColumns('ewc_mcp_write_receipts', [['request_digest', 'TEXT']]);

// Follows + notifications. A member (by Discord id) follows games / tournaments /
// teams / players; match transitions fan out one notification row per follower.
// The notifications table is BOTH the site inbox and the Discord-DM outbox
// (dm_status tracks delivery). entity_key semantics per type:
//   game        -> game slug
//   tournament  -> tournaments.id as text
//   team        -> normalizeTeamName(team name)  (matches store names, not ids)
//   player      -> players.id as text            (resolved via current team at fan-out)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_follows (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('game','tournament','team','player')),
    entity_key      TEXT NOT NULL,
    entity_label    TEXT NOT NULL DEFAULT '',
    entity_ref      TEXT NOT NULL DEFAULT '',
    notify_match_start  INTEGER,
    notify_match_result INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (discord_user_id, entity_type, entity_key)
  );
  CREATE INDEX IF NOT EXISTS idx_user_follows_entity ON user_follows(entity_type, entity_key);
  CREATE INDEX IF NOT EXISTS idx_user_follows_user   ON user_follows(discord_user_id);

  CREATE TABLE IF NOT EXISTS user_match_reminders (
    discord_user_id TEXT    NOT NULL,
    match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    canceled_at     TEXT,
    PRIMARY KEY (discord_user_id, match_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_match_reminders_active_match
    ON user_match_reminders(match_id, discord_user_id) WHERE canceled_at IS NULL;

  CREATE TABLE IF NOT EXISTS user_notification_prefs (
    discord_user_id     TEXT PRIMARY KEY,
    dm_enabled          INTEGER NOT NULL DEFAULT 1,
    notify_match_start  INTEGER NOT NULL DEFAULT 1,
    notify_match_result INTEGER NOT NULL DEFAULT 1,
    dm_delivery_mode    TEXT NOT NULL DEFAULT 'instant',
    timezone            TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    quiet_start_minute  INTEGER,
    quiet_end_minute    INTEGER,
    digest_minute       INTEGER NOT NULL DEFAULT 1080,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('match_start','match_result')),
    match_id        INTEGER,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL DEFAULT '',
    dedupe_key      TEXT NOT NULL,
    read_at         TEXT,
    dm_status       TEXT NOT NULL DEFAULT 'skipped' CHECK (dm_status IN ('pending','sent','skipped','failed')),
    dm_delivery_mode TEXT NOT NULL DEFAULT 'instant',
    dm_not_before    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (discord_user_id, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(discord_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_notifications_dm   ON user_notifications(dm_status);

  CREATE TABLE IF NOT EXISTS web_analytics_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id       TEXT NOT NULL,
    session_id       TEXT NOT NULL,
    event_type       TEXT NOT NULL CHECK (event_type IN ('pageview','engagement')),
    path             TEXT NOT NULL,
    acquisition_source TEXT NOT NULL DEFAULT 'direct'
      CHECK (acquisition_source IN ('direct','x','discord','google','bing','other_referral')),
    campaign         TEXT CHECK (campaign IS NULL OR (length(campaign) BETWEEN 1 AND 64)),
    country          TEXT,
    user_agent       TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    occurred_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_web_analytics_occurred
    ON web_analytics_events(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_web_analytics_visitor
    ON web_analytics_events(visitor_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_web_analytics_session
    ON web_analytics_events(session_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_web_analytics_country
    ON web_analytics_events(country, occurred_at DESC);

  CREATE TABLE IF NOT EXISTS web_product_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id         TEXT NOT NULL,
    session_id         TEXT NOT NULL,
    event_name         TEXT NOT NULL CHECK (event_name IN (
      'prediction_submit','follow_create','follow_remove','notification_prefs_update',
      'multiview_start','multiview_share','site_search_result_open','source_link_open','discord_join_click'
    )),
    path               TEXT NOT NULL,
    acquisition_source TEXT NOT NULL DEFAULT 'direct'
      CHECK (acquisition_source IN ('direct','x','discord','google','bing','other_referral')),
    campaign           TEXT CHECK (campaign IS NULL OR (
      length(campaign) BETWEEN 1 AND 64
      AND substr(campaign, 1, 1) GLOB '[a-z0-9]'
      AND campaign NOT GLOB '*[^a-z0-9_-]*'
    )),
    country            TEXT,
    occurred_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_web_product_events_occurred
    ON web_product_events(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_web_product_events_name_occurred
    ON web_product_events(event_name, occurred_at DESC);
`);

// These are additive so old SQLite databases retain their notification history.
// The due index must be created after ensureColumns has repaired old tables.
ensureColumns('user_follows', [
  ['notify_match_start', 'INTEGER'],
  ['notify_match_result', 'INTEGER'],
]);
ensureColumns('user_notification_prefs', [
  ['dm_delivery_mode', "TEXT NOT NULL DEFAULT 'instant'"],
  ['timezone', "TEXT NOT NULL DEFAULT 'Asia/Riyadh'"],
  ['quiet_start_minute', 'INTEGER'],
  ['quiet_end_minute', 'INTEGER'],
  ['digest_minute', 'INTEGER NOT NULL DEFAULT 1080'],
]);
ensureColumns('user_notifications', [
  ['dm_delivery_mode', 'TEXT'],
  ['dm_not_before', 'INTEGER'],
]);
db.prepare("UPDATE user_notifications SET dm_delivery_mode = 'instant' WHERE dm_delivery_mode IS NULL").run();
db.prepare("UPDATE user_notifications SET dm_not_before = 0 WHERE dm_status = 'pending' AND dm_not_before IS NULL").run();
db.exec('CREATE INDEX IF NOT EXISTS idx_user_notifications_dm_due ON user_notifications(dm_status, dm_not_before, id)');

ensureColumns('web_analytics_events', [
  [
    'acquisition_source',
    "TEXT NOT NULL DEFAULT 'direct' CHECK (acquisition_source IN ('direct','x','discord','google','bing','other_referral'))",
  ],
  ['campaign', 'TEXT CHECK (campaign IS NULL OR (length(campaign) BETWEEN 1 AND 64))'],
]);

// Remove query fragments retained by older ingestion code before dropping the
// legacy raw referrer field.
db.exec(`
  UPDATE web_analytics_events
  SET path = COALESCE(NULLIF(substr(path, 1, instr(path, '?') - 1), ''), '/')
  WHERE instr(path, '?') > 0;
  UPDATE web_analytics_events
  SET path = COALESCE(NULLIF(substr(path, 1, instr(path, '#') - 1), ''), '/')
  WHERE instr(path, '#') > 0;
`);
const webAnalyticsColumns = new Set(db.prepare('PRAGMA table_info(web_analytics_events)').all().map((column) => column.name));
if (webAnalyticsColumns.has('referrer')) {
  db.exec(`
    UPDATE web_analytics_events
    SET acquisition_source = CASE
      WHEN referrer IS NULL OR TRIM(referrer) = '' OR TRIM(referrer) LIKE '/%' THEN 'direct'
      WHEN LOWER(referrer) LIKE '%://x.com'
        OR LOWER(referrer) LIKE '%://x.com/%'
        OR LOWER(referrer) LIKE '%://%.x.com'
        OR LOWER(referrer) LIKE '%://%.x.com/%'
        OR LOWER(referrer) LIKE '%://twitter.com'
        OR LOWER(referrer) LIKE '%://twitter.com/%'
        OR LOWER(referrer) LIKE '%://%.twitter.com'
        OR LOWER(referrer) LIKE '%://%.twitter.com/%'
        OR LOWER(referrer) LIKE '%://t.co'
        OR LOWER(referrer) LIKE '%://t.co/%'
        OR LOWER(referrer) LIKE '%://%.t.co'
        OR LOWER(referrer) LIKE '%://%.t.co/%' THEN 'x'
      WHEN LOWER(referrer) LIKE '%://discord.com'
        OR LOWER(referrer) LIKE '%://discord.com/%'
        OR LOWER(referrer) LIKE '%://%.discord.com'
        OR LOWER(referrer) LIKE '%://%.discord.com/%'
        OR LOWER(referrer) LIKE '%://discord.gg'
        OR LOWER(referrer) LIKE '%://discord.gg/%'
        OR LOWER(referrer) LIKE '%://%.discord.gg'
        OR LOWER(referrer) LIKE '%://%.discord.gg/%'
        OR LOWER(referrer) LIKE '%://discordapp.com'
        OR LOWER(referrer) LIKE '%://discordapp.com/%'
        OR LOWER(referrer) LIKE '%://%.discordapp.com'
        OR LOWER(referrer) LIKE '%://%.discordapp.com/%' THEN 'discord'
      WHEN LOWER(referrer) LIKE '%://google.com'
        OR LOWER(referrer) LIKE '%://%.google.com'
        OR LOWER(referrer) LIKE '%://google.__'
        OR LOWER(referrer) LIKE '%://%.google.__'
        OR LOWER(referrer) LIKE '%://google.___'
        OR LOWER(referrer) LIKE '%://%.google.___'
        OR LOWER(referrer) LIKE '%://google.co.__'
        OR LOWER(referrer) LIKE '%://%.google.co.__'
        OR LOWER(referrer) LIKE '%://google.com.__'
        OR LOWER(referrer) LIKE '%://%.google.com.__' THEN 'google'
      WHEN LOWER(referrer) LIKE '%://bing.com'
        OR LOWER(referrer) LIKE '%://bing.com/%'
        OR LOWER(referrer) LIKE '%://www.bing.com'
        OR LOWER(referrer) LIKE '%://www.bing.com/%'
        OR LOWER(referrer) LIKE '%://%.bing.com'
        OR LOWER(referrer) LIKE '%://%.bing.com/%' THEN 'bing'
      ELSE 'other_referral'
    END
  `);
  db.exec('UPDATE web_analytics_events SET referrer = NULL');
  db.exec('ALTER TABLE web_analytics_events DROP COLUMN referrer');
}

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

logger.info(`SQLite ready at ${process.env.DB_PATH || 'data/bot.sqlite'}`);
