-- An operator can pin a match result that no provider will publish correctly
-- (a forfeit, an early stop, a sheet that keeps deriving the wrong series score).
-- While the lock is set, every writer — including the authoritative official feed —
-- leaves the result fields alone.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS result_locked_at TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS result_locked_by TEXT;
