import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'mcp-write-receipts-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { transaction } = await import('../src/db/client.js');
const {
  claimMcpWriteReceipt,
  completeMcpWriteReceipt,
  getMcpWriteReceipt,
  validateMcpIdempotencyKey,
} = await import('../src/db/mcpWriteReceipts.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('claims, completes, and replays a receipt', async () => {
  const claim = { keyId: 1, toolName: 'create_news_draft', idempotencyKey: 'draft-key-001' };
  const first = await transaction(async (tx) => {
    const claimed = await claimMcpWriteReceipt(tx, claim);
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.receipt.completed, false);
    return completeMcpWriteReceipt(tx, claim, { postId: 42 });
  });
  assert.deepEqual(first.result, { postId: 42 });

  const replay = await transaction(async (tx) => {
    const claimed = await claimMcpWriteReceipt(tx, claim);
    assert.equal(claimed.claimed, false);
    return getMcpWriteReceipt(tx, claim);
  });
  assert.equal(replay.completed, true);
  assert.deepEqual(replay.result, { postId: 42 });
});

test('the same idempotency string is independent per tool', async () => {
  const idempotencyKey = 'shared-tool-key';
  const draft = { keyId: 2, toolName: 'create_news_draft', idempotencyKey };
  const stream = { keyId: 2, toolName: 'update_stream_channel', idempotencyKey };

  await transaction(async (tx) => {
    assert.equal((await claimMcpWriteReceipt(tx, draft)).claimed, true);
    assert.equal((await claimMcpWriteReceipt(tx, stream)).claimed, true);
  });
});

test('the same idempotency string is independent per MCP key', async () => {
  const first = { keyId: 3, toolName: 'create_news_draft', idempotencyKey: 'shared-owner-key' };
  const second = { keyId: 4, toolName: 'create_news_draft', idempotencyKey: 'shared-owner-key' };

  await transaction(async (tx) => {
    assert.equal((await claimMcpWriteReceipt(tx, first)).claimed, true);
    assert.equal((await claimMcpWriteReceipt(tx, second)).claimed, true);
  });
});

test('malformed stored JSON fails closed', async () => {
  const claim = { keyId: 5, toolName: 'create_news_draft', idempotencyKey: 'bad-json-key' };
  await transaction(async (tx) => {
    await tx.run(
      `INSERT INTO ewc_mcp_write_receipts
         (key_id, tool_name, idempotency_key, result_json)
       VALUES ($1, $2, $3, $4)`,
      [claim.keyId, claim.toolName, claim.idempotencyKey, '{"postId":'],
    );
  });

  await assert.rejects(
    () => transaction((tx) => getMcpWriteReceipt(tx, claim)),
    /malformed/i,
  );
});

test('rollback leaves no claimed receipt row', async () => {
  const claim = { keyId: 6, toolName: 'update_stream_channel', idempotencyKey: 'rollback-key-1' };
  await assert.rejects(
    () => transaction(async (tx) => {
      assert.equal((await claimMcpWriteReceipt(tx, claim)).claimed, true);
      throw new Error('rollback now');
    }),
    /rollback now/,
  );

  const receipt = await transaction((tx) => getMcpWriteReceipt(tx, claim));
  assert.equal(receipt, null);
});

test('idempotency keys are bounded opaque strings', () => {
  assert.equal(validateMcpIdempotencyKey('12345678'), '12345678');
  assert.throws(() => validateMcpIdempotencyKey('short'), /8-100/);
  assert.throws(() => validateMcpIdempotencyKey(`bad\nkey-1`), /8-100/);
  assert.throws(() => validateMcpIdempotencyKey(` ${'a'.repeat(8)}`), /8-100/);
});
