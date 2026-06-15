import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-media-posts-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  createEwcNewsPost,
  getEwcNewsPostById,
  listPublishedMediaPosts,
  listPublishedEwcNewsPosts,
  listLatestPublishedEwcNewsPosts,
} = await import('../src/db/ewcNewsPosts.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function make({ gameSlug = null, mediaSlug = null, status = 'published', title = 'T' } = {}) {
  return createEwcNewsPost({
    gameSlug,
    mediaSlug,
    status,
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: { en: { title, summary: 'S', body: 'B' } },
  });
}

test('a media post stores media_slug and a null game_slug', async () => {
  const post = await make({ mediaSlug: 'echo-mena', title: 'Media post' });
  const fetched = await getEwcNewsPostById(post.id);
  assert.equal(fetched.mediaSlug, 'echo-mena');
  assert.equal(fetched.gameSlug, null);
});

test('listPublishedMediaPosts returns a channel’s posts and excludes others', async () => {
  const mine = await make({ mediaSlug: 'chan-a', title: 'Mine' });
  await make({ mediaSlug: 'chan-b', title: 'Other channel' });
  await make({ gameSlug: 'valorant', title: 'Game post' });

  const slugs = (await listPublishedMediaPosts({ mediaSlug: 'chan-a' })).map((p) => p.id);
  assert.ok(slugs.includes(mine.id), 'own channel post included');
  assert.equal(slugs.length, 1, 'only this channel’s posts');
});

test('media posts never leak into the public game news list', async () => {
  // A media post that also tags a related game must NOT appear under that game.
  await make({ gameSlug: 'overwatch', mediaSlug: 'chan-c', title: 'Tagged media post' });
  const gamePost = await make({ gameSlug: 'overwatch', title: 'Real game post' });

  const ids = (await listPublishedEwcNewsPosts({ gameSlug: 'overwatch', locale: 'en' })).map((p) => p.id);
  assert.ok(ids.includes(gamePost.id), 'game post is listed');
  assert.equal(ids.length, 1, 'the related-game media post is excluded');
});

test('media posts are excluded from the global latest-news feed', async () => {
  const before = await listLatestPublishedEwcNewsPosts({ locale: 'en', limit: 50 });
  await make({ mediaSlug: 'chan-d', title: 'Latest media post' });
  const after = await listLatestPublishedEwcNewsPosts({ locale: 'en', limit: 50 });
  assert.equal(after.length, before.length, 'media post does not appear in the global feed');
  assert.ok(after.every((p) => !p.mediaSlug), 'no media posts in the latest feed');
});
