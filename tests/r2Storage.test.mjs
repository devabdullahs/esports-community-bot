import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';

// No R2 env is set in tests, so every function must no-op safely — this is the
// contract that keeps dev, tests, and non-R2 deployments on the local-only cache
// with identical behavior (and never makes a network call).
const { isR2Configured, r2LogoKey, r2GetLogo, r2PutLogo } = await import('../src/lib/r2Storage.js');

test('R2 is not configured without env', () => {
  assert.equal(isR2Configured(), false);
});

test('reads and writes no-op safely when unconfigured (no network, no throw)', async () => {
  assert.equal(await r2GetLogo('deadbeef'), null);
  assert.equal(await r2PutLogo('deadbeef', Buffer.from([0x89, 0x50]), 'image/png'), false);
});

test('r2GetLogo/r2PutLogo ignore a falsy hash', async () => {
  assert.equal(await r2GetLogo(''), null);
  assert.equal(await r2PutLogo('', Buffer.from([0x89]), 'image/png'), false);
});

test('r2LogoKey namespaces under the configured prefix', () => {
  assert.equal(r2LogoKey('abc123'), 'esports-logo-cache/abc123');
});
