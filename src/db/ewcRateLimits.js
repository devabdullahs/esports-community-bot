import { db } from './index.js';

// Fixed-window limiter. Returns { allowed, remaining, retryAfterSec }.
// `amount` lets callers meter bytes as well as counts.
export function consumeRateLimit({ key, limit, windowSec, amount = 1, nowSec = Math.floor(Date.now() / 1000) }) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT window_start, amount FROM ewc_rate_limits WHERE key = ?').get(key);
    if (!row || nowSec - row.window_start >= windowSec) {
      db.prepare(
        `INSERT INTO ewc_rate_limits (key, window_start, amount) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, amount = excluded.amount`,
      ).run(key, nowSec, amount);
      return { allowed: amount <= limit, remaining: Math.max(0, limit - amount), retryAfterSec: amount <= limit ? 0 : windowSec };
    }
    if (row.amount + amount > limit) {
      return { allowed: false, remaining: Math.max(0, limit - row.amount), retryAfterSec: row.window_start + windowSec - nowSec };
    }
    db.prepare('UPDATE ewc_rate_limits SET amount = amount + ? WHERE key = ?').run(amount, key);
    return { allowed: true, remaining: limit - row.amount - amount, retryAfterSec: 0 };
  });
  return tx();
}
