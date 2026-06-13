import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-news-discord-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { run } = await import('../src/db/client.js');
const { createEwcNewsPost, deleteEwcNewsPost } = await import('../src/db/ewcNewsPosts.js');
const {
  deleteDiscordNewsPost,
  getDiscordNewsPost,
  listDiscordNewsPosts,
  listUnpostedPublishedNewsPosts,
  recordDiscordNewsPost,
  resolveNewsChannelId,
  touchDiscordNewsPost,
} = await import('../src/db/ewcNewsDiscordPosts.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function makePost({ status = 'published', gameSlug = 'valorant' } = {}) {
  return createEwcNewsPost({
    gameSlug,
    status,
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Headline', summary: 'Summary', body: 'Body' },
    },
  });
}

test('record + get + delete a Discord news row (CRUD)', async () => {
  const post = await makePost();
  assert.equal(await getDiscordNewsPost(post.id), null);

  await recordDiscordNewsPost(post.id, { guildId: '111', channelId: '222', messageId: '333' });
  const row = await getDiscordNewsPost(post.id);
  assert.equal(row.post_id, post.id);
  assert.equal(row.guild_id, '111');
  assert.equal(row.channel_id, '222');
  assert.equal(row.message_id, '333');
  assert.ok(row.posted_at, 'posted_at is set');

  // Upsert: re-recording updates channel/message without inserting a duplicate.
  await recordDiscordNewsPost(post.id, { guildId: '111', channelId: '999', messageId: '444' });
  assert.equal((await getDiscordNewsPost(post.id)).channel_id, '999');
  assert.equal((await getDiscordNewsPost(post.id)).message_id, '444');

  await deleteDiscordNewsPost(post.id);
  assert.equal(await getDiscordNewsPost(post.id), null);
});

test('anti-join returns only published posts without a Discord row', async () => {
  const published = await makePost({ status: 'published' });
  const draft = await makePost({ status: 'draft' });
  const posted = await makePost({ status: 'published' });
  await recordDiscordNewsPost(posted.id, { guildId: '1', channelId: '2', messageId: '3' });

  const ids = (await listUnpostedPublishedNewsPosts()).map((r) => r.post_id);
  assert.ok(ids.includes(published.id), 'published-unposted is included');
  assert.ok(!ids.includes(draft.id), 'draft is excluded');
  assert.ok(!ids.includes(posted.id), 'already-posted is excluded');

  // Cleanup so later tests have a clean anti-join surface.
  await deleteEwcNewsPost(published.id);
  await deleteEwcNewsPost(draft.id);
  await deleteEwcNewsPost(posted.id);
});

test('listDiscordNewsPosts joins post status + updated_at for edit/unpublish detection', async () => {
  const post = await makePost({ status: 'published' });
  await recordDiscordNewsPost(post.id, { guildId: '1', channelId: '2', messageId: '3' });
  const rows = (await listDiscordNewsPosts()).filter((r) => r.post_id === post.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'published');
  assert.ok(rows[0].updated_at, 'post updated_at is exposed for edit detection');
  assert.equal(rows[0].game_slug, 'valorant');
  await deleteEwcNewsPost(post.id);
});

test('touchDiscordNewsPost advances posted_at past the original', async () => {
  const post = await makePost();
  await recordDiscordNewsPost(post.id, { guildId: '1', channelId: '2', messageId: '3' });
  // Force an older posted_at so the touch is observable without relying on sub-second clocks.
  await run(`UPDATE ewc_news_discord_posts SET posted_at = '2000-01-01 00:00:00' WHERE post_id = $1`, [post.id]);
  const before = (await getDiscordNewsPost(post.id)).posted_at;
  await touchDiscordNewsPost(post.id);
  const after = (await getDiscordNewsPost(post.id)).posted_at;
  assert.ok(after > before, 'posted_at moves forward after touch');
  await deleteEwcNewsPost(post.id);
});

test('deleting a post cascades and removes its Discord row (FK pragma is ON)', async () => {
  const post = await makePost();
  await recordDiscordNewsPost(post.id, { guildId: '1', channelId: '2', messageId: '3' });
  assert.ok((await getDiscordNewsPost(post.id)) !== null);

  await deleteEwcNewsPost(post.id);
  assert.equal(await getDiscordNewsPost(post.id), null, 'row is gone after the post is hard-deleted');
});

test('resolveNewsChannelId: game channel beats default beats none', () => {
  // Game channel wins.
  assert.equal(
    resolveNewsChannelId({ gameChannelId: 'game-chan', guildNewsChannelId: 'default-chan' }),
    'game-chan',
  );
  // Falls back to the guild default when no game channel.
  assert.equal(
    resolveNewsChannelId({ gameChannelId: null, guildNewsChannelId: 'default-chan' }),
    'default-chan',
  );
  // No channel anywhere → null (caller skips posting).
  assert.equal(resolveNewsChannelId({ gameChannelId: null, guildNewsChannelId: null }), null);
});
