-- Private-provider state contains opaque hashes/timestamps and normalized
-- public tournament data only. Upstream folder/workbook/sheet ids are not
-- persisted.
CREATE TABLE IF NOT EXISTS official_feed_state (
  workbook_key   TEXT PRIMARY KEY,
  modified_token TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS official_match_authority (
  match_id      BIGINT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  observed_at   BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL,
  content_hash  TEXT NOT NULL,
  fields_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_official_match_authority_expiry
  ON official_match_authority(expires_at);

CREATE TABLE IF NOT EXISTS official_standings_authority (
  tournament_id BIGINT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  observed_at   BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL,
  content_hash  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_overviews (
  tournament_id BIGINT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  payload_json  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS official_overview_authority (
  tournament_id BIGINT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  observed_at   BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL,
  content_hash  TEXT NOT NULL
);
