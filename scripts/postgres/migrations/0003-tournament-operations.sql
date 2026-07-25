ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS lifecycle_generation BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS display_name_override TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS game_override TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ewc_override INTEGER CHECK (ewc_override IN (0, 1));

CREATE TABLE IF NOT EXISTS tournament_data_health (
  tournament_id          BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  data_kind              TEXT NOT NULL CHECK (data_kind IN ('schedule','standings')),
  source                 TEXT NOT NULL CHECK (source IN ('liquipedia','startgg','pandascore')),
  supported              INTEGER NOT NULL DEFAULT 1 CHECK (supported IN (0, 1)),
  last_attempt_at        BIGINT,
  last_success_at        BIGINT,
  last_failure_at        BIGINT,
  last_failure_category  TEXT CHECK (last_failure_category IN ('rate_limit','auth','timeout','network','parse','empty','stale_generation','unknown')),
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  last_item_count        INTEGER,
  updated_at             BIGINT NOT NULL,
  PRIMARY KEY (tournament_id, data_kind)
);
CREATE INDEX IF NOT EXISTS idx_tournament_data_health_state
  ON tournament_data_health(data_kind, last_success_at DESC);

CREATE TABLE IF NOT EXISTS tournament_operations (
  id                   TEXT PRIMARY KEY,
  guild_id             TEXT NOT NULL,
  tournament_id        BIGINT REFERENCES tournaments(id) ON DELETE CASCADE,
  operation            TEXT NOT NULL CHECK (operation IN (
                         'validate_and_activate','sync_schedule','sync_standings',
                         'archive','deactivate','reactivate'
                       )),
  source               TEXT CHECK (source IN ('liquipedia','startgg','pandascore')),
  source_id            TEXT,
  game                 TEXT,
  status               TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','running','succeeded','failed')),
  idempotency_key      TEXT NOT NULL UNIQUE,
  requested_actor_id   TEXT,
  requested_actor_name TEXT,
  requested_actor_type TEXT NOT NULL CHECK (requested_actor_type IN ('discord_admin','web_admin','system')),
  requested_at         TEXT NOT NULL,
  lease_token          TEXT,
  lease_expires_at     BIGINT,
  attempts             INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 20),
  started_at           TEXT,
  completed_at         TEXT,
  result_code          TEXT,
  failure_code         TEXT,
  result_tournament_id BIGINT REFERENCES tournaments(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tournament_operations_claim
  ON tournament_operations(status, lease_expires_at, requested_at);
CREATE INDEX IF NOT EXISTS idx_tournament_operations_target
  ON tournament_operations(tournament_id, requested_at DESC);
