import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePgSslConfig } from '../src/db/client.js';

// Existing modes must be byte-for-byte what the old postgresSslConfig returned,
// so no current deployment changes behavior.
test('disable returns false (no TLS)', () => {
  assert.equal(resolvePgSslConfig('disable'), false);
});

test('require / no-verify encrypt without verifying the cert', () => {
  assert.deepEqual(resolvePgSslConfig('require'), { rejectUnauthorized: false });
  assert.deepEqual(resolvePgSslConfig('no-verify'), { rejectUnauthorized: false });
});

test('verify-ca / verify-full verify the cert', () => {
  assert.deepEqual(resolvePgSslConfig('verify-ca'), { rejectUnauthorized: true });
  assert.deepEqual(resolvePgSslConfig('verify-full'), { rejectUnauthorized: true });
});

test('unset / unknown returns undefined (node-pg falls back to the URL sslmode)', () => {
  assert.equal(resolvePgSslConfig(''), undefined);
  assert.equal(resolvePgSslConfig(undefined), undefined);
  assert.equal(resolvePgSslConfig('something-else'), undefined);
});

test('mode is case-insensitive', () => {
  assert.deepEqual(resolvePgSslConfig('REQUIRE'), { rejectUnauthorized: false });
  assert.deepEqual(resolvePgSslConfig('Verify-Full'), { rejectUnauthorized: true });
});
