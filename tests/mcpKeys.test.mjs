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
  hashMcpKeySecret,
  listMcpKeys,
  revokeMcpKey,
  touchMcpKey,
  verifyMcpKeySecret,
} = await import('../src/db/mcpKeys.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

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
  assert.notEqual(key.keyHash, secret);
  assert.equal(key.keyHash, hashMcpKeySecret(secret));
  assert.deepEqual(key.tools, ['get_site_overview']);
  assert.deepEqual(key.games, ['valorant']);
  assert.deepEqual(key.media, ['newsroom']);

  const verified = await verifyMcpKeySecret(secret);
  assert.equal(verified.id, key.id);
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
  assert.ok(await verifyMcpKeySecret(expired.secret, 99));
});

test('lists active keys before revoked keys', async () => {
  const keys = await listMcpKeys();
  assert.ok(keys.length >= 4);
  const firstRevoked = keys.findIndex((key) => key.revokedAt);
  if (firstRevoked !== -1) {
    assert.ok(keys.slice(0, firstRevoked).every((key) => !key.revokedAt));
    assert.ok(keys.slice(firstRevoked).every((key) => key.revokedAt));
  }
});
