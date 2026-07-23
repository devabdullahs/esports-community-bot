import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-owner-delete-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { get, run } = await import('../src/db/client.js');
const { createEwcGame, deleteEwcGame } = await import('../src/db/ewcGames.js');
const {
  createEwcMediaChannel,
  getEwcMediaChannel,
} = await import('../src/db/ewcMediaChannels.js');
const { createEwcNewsPost, getEwcNewsPostById } = await import('../src/db/ewcNewsPosts.js');
const {
  upsertEwcAdmin,
  setEwcAdminGameScopes,
  getEwcAdminGameScopes,
} = await import('../src/db/ewcAdmins.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function createGame(slug) {
  return createEwcGame({
    slug,
    title: { en: slug, ar: slug },
    description: { en: 'Description', ar: 'Description' },
    status: { en: 'Active', ar: 'Active' },
    owner: { en: 'Owner', ar: 'Owner' },
    focus: [],
  });
}

function createPost({ gameSlug = null, mediaSlug = null, status = 'published', title }) {
  return createEwcNewsPost({
    gameSlug,
    mediaSlug,
    status,
    contentMode: 'translated',
    defaultLocale: 'en',
    translations: {
      en: { title, summary: `${title} summary`, body: `${title} body` },
      ar: { title: `${title} AR`, summary: `${title} AR summary`, body: `${title} AR body` },
    },
  });
}

async function addDependents(postId, suffix) {
  await run(
    `INSERT INTO ewc_news_post_authors
       (post_id, discord_id, name, avatar_url, sort_order)
     VALUES ($1, $2, $3, NULL, 0)`,
    [postId, `author-${suffix}`, `Author ${suffix}`],
  );
  await run(
    `INSERT INTO post_comments
       (post_id, target_type, target_id, auth_user_id, discord_user_id, author_name, body)
     VALUES ($1, 'news', $1, $2, $3, $4, $5)`,
    [postId, `auth-${suffix}`, `discord-${suffix}`, `Reader ${suffix}`, `Comment ${suffix}`],
  );
}

test('deleteEwcGame deletes owned posts and detaches media-owned game tags atomically', async () => {
  await createGame('delete-owner-game');
  await createGame('neighbor-game');

  await createEwcMediaChannel({
    slug: 'tagged-channel',
    name: { en: 'Tagged channel', ar: 'Tagged channel' },
    description: { en: '', ar: '' },
    logoUrl: null,
    links: [],
    gameSlug: 'delete-owner-game',
  });
  await createEwcMediaChannel({
    slug: 'unrelated-channel',
    name: { en: 'Unrelated channel', ar: 'Unrelated channel' },
    description: { en: '', ar: '' },
    logoUrl: null,
    links: [],
    gameSlug: 'neighbor-game',
  });

  const ownedPost = await createPost({
    gameSlug: 'delete-owner-game',
    title: 'Game owned',
  });
  const taggedMediaPost = await createPost({
    gameSlug: 'delete-owner-game',
    mediaSlug: 'tagged-channel',
    title: 'Media owned and tagged',
  });
  const unrelatedMediaPost = await createPost({
    mediaSlug: 'unrelated-channel',
    title: 'Unrelated media',
  });
  const unrelatedGamePost = await createPost({
    gameSlug: 'neighbor-game',
    title: 'Unrelated game',
  });

  await addDependents(ownedPost.id, 'owned');
  await addDependents(taggedMediaPost.id, 'media');

  await upsertEwcAdmin({ discordId: 'admin-001', displayName: 'Test Admin' });
  await setEwcAdminGameScopes('admin-001', ['delete-owner-game', 'neighbor-game']);

  const result = await deleteEwcGame('delete-owner-game');
  assert.deepEqual(result, {
    gameDeleted: 1,
    postsDeleted: 1,
    mediaPostsDetached: 1,
    mediaChannelsDetached: 1,
  });

  assert.equal(await getEwcNewsPostById(ownedPost.id), null, 'game-owned post is deleted');

  const detachedPost = await getEwcNewsPostById(taggedMediaPost.id);
  assert.ok(detachedPost, 'media-owned post survives');
  assert.equal(detachedPost.gameSlug, null, 'optional game tag is cleared');
  assert.equal(detachedPost.mediaSlug, 'tagged-channel', 'media ownership is retained');

  assert.ok(await getEwcNewsPostById(unrelatedMediaPost.id), 'unrelated media post survives');
  assert.ok(await getEwcNewsPostById(unrelatedGamePost.id), 'unrelated game post survives');

  const taggedChannel = await getEwcMediaChannel('tagged-channel');
  const unrelatedChannel = await getEwcMediaChannel('unrelated-channel');
  assert.equal(taggedChannel.gameSlug, null, 'related media channel is detached');
  assert.equal(unrelatedChannel.gameSlug, 'neighbor-game', 'unrelated channel is unchanged');

  const ownedTranslations = await get(
    'SELECT COUNT(*) AS count FROM ewc_news_post_translations WHERE post_id = $1',
    [ownedPost.id],
  );
  const mediaTranslations = await get(
    'SELECT COUNT(*) AS count FROM ewc_news_post_translations WHERE post_id = $1',
    [taggedMediaPost.id],
  );
  assert.equal(ownedTranslations.count, 0, 'deleted post translations are removed');
  assert.equal(mediaTranslations.count, 2, 'surviving media translations are retained');

  const ownedAuthors = await get(
    'SELECT COUNT(*) AS count FROM ewc_news_post_authors WHERE post_id = $1',
    [ownedPost.id],
  );
  const mediaAuthors = await get(
    'SELECT COUNT(*) AS count FROM ewc_news_post_authors WHERE post_id = $1',
    [taggedMediaPost.id],
  );
  const ownedComments = await get(
    'SELECT COUNT(*) AS count FROM post_comments WHERE post_id = $1',
    [ownedPost.id],
  );
  const mediaComments = await get(
    'SELECT COUNT(*) AS count FROM post_comments WHERE post_id = $1',
    [taggedMediaPost.id],
  );
  assert.equal(ownedAuthors.count, 0, 'deleted post authors cascade');
  assert.equal(ownedComments.count, 0, 'deleted post comments cascade');
  assert.equal(mediaAuthors.count, 1, 'surviving media authors remain');
  assert.equal(mediaComments.count, 1, 'surviving media comments remain');

  const scopes = await getEwcAdminGameScopes('admin-001');
  assert.deepEqual(scopes, ['neighbor-game'], 'only the deleted game scope is removed');
});
