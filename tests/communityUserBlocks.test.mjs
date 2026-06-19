import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'community-blocks-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  blockUser,
  getBlock,
  isUserBlocked,
  listBlockedUsers,
  unblockUser,
} = await import('../src/db/communityUserBlocks.js');

const userA = '300000000000000001';
const userB = '300000000000000002';

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('blockUser stores the block; isUserBlocked + getBlock reflect it', async () => {
  const row = await blockUser({
    discordUserId: userA,
    blockedBy: 'admin-1',
    blockedByName: 'Admin One',
    reason: 'spamming links',
  });

  assert.equal(row.discordUserId, userA);
  assert.equal(row.reason, 'spamming links');
  assert.equal(await isUserBlocked(userA), true);

  const fetched = await getBlock(userA);
  assert.equal(fetched.reason, 'spamming links');
  assert.equal(fetched.blockedBy, 'admin-1');
  assert.equal(fetched.blockedByName, 'Admin One');
});

test('re-blocking the same user upserts a single row', async () => {
  await blockUser({ discordUserId: userA, blockedBy: 'admin-2', reason: 'still spamming' });

  const blocks = await listBlockedUsers();
  const forUserA = blocks.filter((b) => b.discordUserId === userA);
  assert.equal(forUserA.length, 1);
  assert.equal(forUserA[0].blockedBy, 'admin-2');
  assert.equal(forUserA[0].reason, 'still spamming');
});

test('unblockUser removes the block and isUserBlocked returns false', async () => {
  const result = await unblockUser(userA);
  assert.deepEqual(result, { removed: 1 });
  assert.equal(await isUserBlocked(userA), false);
  assert.equal(await getBlock(userA), null);
});

test('listBlockedUsers returns rows newest-first', async () => {
  await blockUser({ discordUserId: userA, blockedBy: 'admin', reason: 'first' });
  // Ensure a distinct created_at ordering key for the second block.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await blockUser({ discordUserId: userB, blockedBy: 'admin', reason: 'second' });

  const blocks = await listBlockedUsers();
  assert.equal(blocks[0].discordUserId, userB);
  assert.equal(blocks[1].discordUserId, userA);
});
