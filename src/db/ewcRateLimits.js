import { isPostgres, run, transaction } from './client.js';

// Bounded key retention: windows expire logically but their rows used to live
// forever, so high-cardinality keys accumulated without limit. No live window
// is ever a day old — anything older is garbage.
const PURGE_AGE_SEC = 24 * 60 * 60;

export async function purgeExpiredRateLimits(nowSec = Math.floor(Date.now() / 1000)) {
  await run('DELETE FROM ewc_rate_limits WHERE window_start < $1', [nowSec - PURGE_AGE_SEC]);
}

// Fixed-window limiter. Returns { allowed, remaining, retryAfterSec }.
// `amount` lets callers meter bytes as well as counts.
export async function consumeRateLimit({ key, limit, windowSec, amount = 1, nowSec = Math.floor(Date.now() / 1000) }) {
  // Opportunistic sweep (~1% of calls) keeps the table bounded without a
  // dedicated job; a failed sweep never affects the limit decision.
  if (Math.random() < 0.01) purgeExpiredRateLimits(nowSec).catch(() => {});
  return transaction(async (tx) => {
    if (isPostgres()) {
      await tx.get('SELECT pg_advisory_xact_lock(hashtext($1)) AS locked', [key]);
    }
    const row = await tx.get('SELECT window_start, amount FROM ewc_rate_limits WHERE key = $1', [key]);
    if (!row || nowSec - row.window_start >= windowSec) {
      await tx.run(
        `INSERT INTO ewc_rate_limits (key, window_start, amount) VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, amount = excluded.amount`,
        [key, nowSec, amount],
      );
      return { allowed: amount <= limit, remaining: Math.max(0, limit - amount), retryAfterSec: amount <= limit ? 0 : windowSec };
    }
    if (row.amount + amount > limit) {
      return { allowed: false, remaining: Math.max(0, limit - row.amount), retryAfterSec: row.window_start + windowSec - nowSec };
    }
    await tx.run('UPDATE ewc_rate_limits SET amount = amount + $1 WHERE key = $2', [amount, key]);
    return { allowed: true, remaining: limit - row.amount - amount, retryAfterSec: 0 };
  });
}
