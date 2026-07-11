import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'mcp-keys-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  MCP_TOOL_NAMES,
  createMcpKey,
  getMcpKey,
  listMcpKeys,
  revokeMcpKey,
  touchMcpKey,
  verifyMcpKeySecret,
} = await import('../src/db/mcpKeys.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function assertNoVerifier(value) {
  assert.equal(Object.hasOwn(value, 'keyHash'), false);
  assert.equal(Object.hasOwn(value, 'key_hash'), false);
}

test('creates one-time MCP key secret and stores only hash metadata', async () => {
  const { key, secret } = await createMcpKey({
    label: 'Codex',
    ownerDiscordId: '123456789012345678',
    ownerName: 'Admin',
    tools: ['get_site_overview'],
    games: ['valorant'],
    media: ['newsroom'],
    createdBy: '123456789012345678',
  });

  assert.match(secret, /^ec_mcp_live_/);
  assert.equal(key.keyPrefix, secret.slice(0, 18));
  assertNoVerifier(key);
  assert.deepEqual(key.tools, ['get_site_overview']);
  assert.deepEqual(key.games, ['valorant']);
  assert.deepEqual(key.media, ['newsroom']);

  const verified = await verifyMcpKeySecret(secret);
  assert.equal(verified.id, key.id);
  assertNoVerifier(verified);
  assert.equal(await verifyMcpKeySecret(`${secret}wrong`), null);
});

test('defaults empty tool list to every MCP tool', async () => {
  const { key } = await createMcpKey({
    ownerDiscordId: '123456789012345679',
    tools: [],
  });

  assert.deepEqual(key.tools, MCP_TOOL_NAMES);
});

test('touch updates last-used timestamp', async () => {
  const { key } = await createMcpKey({ ownerDiscordId: '123456789012345680' });
  assert.equal(key.lastUsedAt, null);

  await touchMcpKey(key.id);
  const updated = await getMcpKey(key.id);
  assert.ok(updated.lastUsedAt, 'last-used timestamp should be set');
  assertNoVerifier(updated);
});

test('revoked and expired MCP keys do not verify', async () => {
  const revoked = await createMcpKey({ ownerDiscordId: '123456789012345681' });
  assert.ok(await verifyMcpKeySecret(revoked.secret));

  await revokeMcpKey(revoked.key.id);
  assert.equal(await verifyMcpKeySecret(revoked.secret), null);

  const expired = await createMcpKey({
    ownerDiscordId: '123456789012345682',
    expiresAt: 100,
  });
  assert.equal(await verifyMcpKeySecret(expired.secret, 101), null);
  const validBeforeExpiry = await verifyMcpKeySecret(expired.secret, 99);
  assert.ok(validBeforeExpiry);
  assertNoVerifier(validBeforeExpiry);
});

test('lists active keys before revoked keys', async () => {
  const keys = await listMcpKeys();
  assert.ok(keys.length >= 4);
  keys.forEach(assertNoVerifier);
  const firstRevoked = keys.findIndex((key) => key.revokedAt);
  if (firstRevoked !== -1) {
    assert.ok(keys.slice(0, firstRevoked).every((key) => !key.revokedAt));
    assert.ok(keys.slice(firstRevoked).every((key) => key.revokedAt));
  }
});

test('malformed or empty stored tools_json fails closed to zero tools', async () => {
  const { run } = await import('../src/db/client.js');
  const created = await createMcpKey({
    ownerDiscordId: '123456789012345690',
    tools: ['get_site_overview'],
  });
  await run("UPDATE ewc_mcp_keys SET tools_json = '{malformed' WHERE id = $1", [created.key.id]);
  const malformed = await getMcpKey(created.key.id);
  assert.deepEqual(malformed.tools, []);
  await run("UPDATE ewc_mcp_keys SET tools_json = '' WHERE id = $1", [created.key.id]);
  const empty = await getMcpKey(created.key.id);
  assert.deepEqual(empty.tools, []);
  const verified = await verifyMcpKeySecret(created.secret);
  assert.deepEqual(verified.tools, []);
});
