CREATE TABLE IF NOT EXISTS user_push_subscriptions (
  id              TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_failure_at TEXT,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  revoked_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_push_subscriptions_user
  ON user_push_subscriptions(discord_user_id, revoked_at);

CREATE TABLE IF NOT EXISTS user_push_deliveries (
  notification_id BIGINT NOT NULL REFERENCES user_notifications(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES user_push_subscriptions(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','skipped','failed')),
  not_before      BIGINT NOT NULL DEFAULT 0,
  attempts        INTEGER NOT NULL DEFAULT 0,
  delivered_at   TEXT,
  last_failure_at TEXT,
  last_failure_code TEXT,
  PRIMARY KEY (notification_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_user_push_deliveries_due
  ON user_push_deliveries(status, not_before, notification_id);
