import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-media-delete-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { get, run } = await import('../src/db/client.js');
const {
  createEwcMediaChannel,
  deleteEwcMediaChannel,
  getEwcMediaChannel,
} = await import('../src/db/ewcMediaChannels.js');
const { createEwcNewsPost, getEwcNewsPostById } = await import('../src/db/ewcNewsPosts.js');
const {
  getEwcAdminMediaScopes,
  setEwcAdminMediaScopes,
  upsertEwcAdmin,
} = await import('../src/db/ewcAdmins.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function createChannel(slug) {
  return createEwcMediaChannel({
    slug,
    name: { en: slug, ar: slug },
    description: { en: '', ar: '' },
    logoUrl: null,
    links: [],
  });
}

function createMediaPost(mediaSlug, status, title) {
  return createEwcNewsPost({
    mediaSlug,
    status,
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title, summary: `${title} summary`, body: `${title} body` },
    },
  });
}

test('deleteEwcMediaChannel blocks atomically while draft or published posts exist', async () => {
  await createChannel('channel-with-posts');
  const draft = await createMediaPost('channel-with-posts', 'draft', 'Draft');
  const published = await createMediaPost('channel-with-posts', 'published', 'Published');

  await upsertEwcAdmin({ discordId: 'media-admin', displayName: 'Media admin' });
  await setEwcAdminMediaScopes('media-admin', ['channel-with-posts']);
  await run(
    `INSERT INTO ewc_media_discord_posts (slug, guild_id, channel_id, message_id)
     VALUES ($1, $2, $3, $4)`,
    ['channel-with-posts', 'guild', 'channel', 'message'],
  );

  const result = await deleteEwcMediaChannel('channel-with-posts');
  assert.deepEqual(result, {
    deleted: 0,
    conflict: 'media_has_posts',
    postCount: 2,
  });

  assert.ok(await getEwcMediaChannel('channel-with-posts'), 'channel remains');
  assert.ok(await getEwcNewsPostById(draft.id), 'draft post remains');
  assert.ok(await getEwcNewsPostById(published.id), 'published post remains');
  assert.deepEqual(
    await getEwcAdminMediaScopes('media-admin'),
    ['channel-with-posts'],
    'admin scope remains',
  );
  assert.ok(
    await get('SELECT slug FROM ewc_media_discord_posts WHERE slug = $1', ['channel-with-posts']),
    'Discord linkage remains',
  );
});

test('deleteEwcMediaChannel deletes an empty channel and its auxiliary rows', async () => {
  await createChannel('empty-channel');
  await upsertEwcAdmin({ discordId: 'empty-admin', displayName: 'Empty admin' });
  await setEwcAdminMediaScopes('empty-admin', ['empty-channel']);
  await run(
    `INSERT INTO ewc_media_discord_posts (slug, guild_id, channel_id, message_id)
     VALUES ($1, $2, $3, $4)`,
    ['empty-channel', 'guild', 'channel', 'message'],
  );

  const result = await deleteEwcMediaChannel('empty-channel');
  assert.deepEqual(result, {
    deleted: 1,
    conflict: null,
    postCount: 0,
  });
  assert.equal(await getEwcMediaChannel('empty-channel'), null);
  assert.deepEqual(await getEwcAdminMediaScopes('empty-admin'), []);
  assert.equal(
    await get('SELECT slug FROM ewc_media_discord_posts WHERE slug = $1', ['empty-channel']),
    null,
  );
});
