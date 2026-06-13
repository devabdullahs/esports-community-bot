import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-ratelimits-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { consumeRateLimit } = await import('../src/db/ewcRateLimits.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('under-limit: allows up to the limit', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = `test-under:${now}`;

  const r1 = await consumeRateLimit({ key, limit: 3, windowSec: 60, nowSec: now });
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);
  assert.equal(r1.retryAfterSec, 0);

  const r2 = await consumeRateLimit({ key, limit: 3, windowSec: 60, nowSec: now });
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);

  const r3 = await consumeRateLimit({ key, limit: 3, windowSec: 60, nowSec: now });
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);
});

test('exceeding limit: denies with correct retryAfterSec', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = `test-exceed:${now}`;

  // Fill the window.
  await consumeRateLimit({ key, limit: 2, windowSec: 300, nowSec: now });
  await consumeRateLimit({ key, limit: 2, windowSec: 300, nowSec: now });

  // 3rd call should be denied.
  const r = await consumeRateLimit({ key, limit: 2, windowSec: 300, nowSec: now });
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
  // retryAfterSec = window_start + windowSec - nowSec; window_start == now, so = 300.
  assert.equal(r.retryAfterSec, 300);
});

test('window expiry resets the counter', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = `test-expiry:${now}`;

  // Fill within window.
  await consumeRateLimit({ key, limit: 1, windowSec: 60, nowSec: now });
  const denied = await consumeRateLimit({ key, limit: 1, windowSec: 60, nowSec: now });
  assert.equal(denied.allowed, false);

  // Advance past the window.
  const later = now + 61;
  const reset = await consumeRateLimit({ key, limit: 1, windowSec: 60, nowSec: later });
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 0);
});

test('byte-metering: amount accumulates correctly', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = `test-bytes:${now}`;
  const MB = 1024 * 1024;

  // 100 MB allowed, 200 MB limit.
  const r1 = await consumeRateLimit({ key, limit: 200 * MB, windowSec: 86400, amount: 100 * MB, nowSec: now });
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 100 * MB);

  // Another 100 MB — fills the limit exactly.
  const r2 = await consumeRateLimit({ key, limit: 200 * MB, windowSec: 86400, amount: 100 * MB, nowSec: now });
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);

  // 1 more byte over limit.
  const r3 = await consumeRateLimit({ key, limit: 200 * MB, windowSec: 86400, amount: 1, nowSec: now });
  assert.equal(r3.allowed, false);
});

test('oversized single amount > limit denies on first call', async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = `test-oversized:${now}`;

  // amount=10 > limit=5: the new-window branch returns remaining=max(0, 5-10)=0
  const r = await consumeRateLimit({ key, limit: 5, windowSec: 60, amount: 10, nowSec: now });
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
  assert.equal(r.retryAfterSec, 60);
});
