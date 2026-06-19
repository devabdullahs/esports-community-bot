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
  ['ewc_news_channel_id', 'TEXT'],
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

  CREATE TABLE IF NOT EXISTS ewc_profile_links (
    auth_user_id     TEXT NOT NULL,
    discord_user_id  TEXT PRIMARY KEY,
    guild_id         TEXT NOT NULL,
    season           TEXT NOT NULL DEFAULT '2026',
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
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    author_discord_id TEXT,
    author_name       TEXT,
    cover_image_url   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    published_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_game_status
    ON ewc_news_posts(game_slug, status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ewc_news_posts_media_status
    ON ewc_news_posts(media_slug, status, published_at DESC);
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

  -- Community comments on news posts. One-level threads: a reply's parent/root
  -- both point at the ROOT comment (replies to replies are re-targeted to the
  -- root in createComment). Soft delete (status='deleted') keeps reply threads
  -- intact; a hard-deleted POST cascades its comments away.
  CREATE TABLE IF NOT EXISTS post_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id           INTEGER NOT NULL REFERENCES ewc_news_posts(id) ON DELETE CASCADE,
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
    deleted_by        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_post_comments_root ON post_comments(root_comment_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_post_comments_autoapprove ON post_comments(status, auto_approve_at);

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

  CREATE TABLE IF NOT EXISTS community_user_blocks (
    discord_user_id TEXT PRIMARY KEY,
    blocked_by      TEXT NOT NULL,
    blocked_by_name TEXT,
    reason          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

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
`);

ensureColumns('ewc_prediction_weeks', [
  ['score_after', 'INTEGER'],
  ['start_at', 'INTEGER'],
  ['end_at', 'INTEGER'],
  ['games_json', 'TEXT'],
  ['results_json', 'TEXT'],
]);
ensureColumns('ewc_prediction_seasons', [['score_after', 'INTEGER'], ['best_weeks', 'INTEGER']]);
ensureColumns('post_comments', [['author_avatar_url', 'TEXT']]);
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
]);
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
