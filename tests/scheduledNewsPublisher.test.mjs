import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'scheduled-news-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { closeDb } = await import('../src/db/index.js');
const {
  createEwcNewsPost,
  getEwcNewsPostById,
  publishDueEwcNewsPosts,
  updateEwcNewsPost,
} = await import('../src/db/ewcNewsPosts.js');
const { listAdminAuditLog } = await import('../src/db/ewcAdminAuditLog.js');
const { hasPendingScheduledNewsCacheRevalidation } = await import('../src/db/ewcAdminAuditLog.js');
const { listUnpostedPublishedNewsPosts, recordDiscordNewsPost } = await import('../src/db/ewcNewsDiscordPosts.js');
const { runScheduledNewsPublisher } = await import('../src/jobs/scheduledNewsPublisher.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function scheduledPost(scheduledPublishAt, title) {
  return createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'scheduled',
    scheduledPublishAt,
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title, summary: '', body: `${title} body` },
    },
  });
}

test('promotes due posts once, leaves future posts scheduled, and creates an audit row', async () => {
  const due = await scheduledPost('2030-01-01T09:00:00.000Z', 'Due post');
  const future = await scheduledPost('2030-01-01T11:00:00.000Z', 'Future post');
  const alreadyPublished = await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'published',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: { en: { title: 'Already public', summary: '', body: 'Body' } },
  });

  assert.deepEqual(await listUnpostedPublishedNewsPosts(), [{
    post_id: alreadyPublished.id,
    game_slug: 'valorant',
    media_slug: null,
  }]);

  const published = await publishDueEwcNewsPosts({ now: '2030-01-01 10:00:00' });
  assert.deepEqual(published.map((post) => post.id), [due.id]);
  assert.equal((await getEwcNewsPostById(due.id)).status, 'published');
  assert.equal((await getEwcNewsPostById(due.id)).scheduledPublishAt, '2030-01-01 09:00:00');
  assert.equal((await getEwcNewsPostById(future.id)).status, 'scheduled');

  const unposted = await listUnpostedPublishedNewsPosts();
  assert.deepEqual(new Set(unposted.map((post) => post.post_id)), new Set([alreadyPublished.id, due.id]));
  await recordDiscordNewsPost(due.id, { guildId: 'guild', channelId: 'channel', messageId: 'message' });
  assert.ok(
    !(await listUnpostedPublishedNewsPosts()).some((post) => post.post_id === due.id),
    'the existing Discord outbox row suppresses a second announcement',
  );

  const audit = (await listAdminAuditLog()).find((entry) => entry.target === String(due.id));
  assert.equal(audit?.action, 'news.publish_scheduled');
  assert.deepEqual(audit?.details, { scheduledPublishAt: '2030-01-01 09:00:00' });

  assert.deepEqual(await publishDueEwcNewsPosts({ now: '2030-01-01 10:00:00' }), []);
  assert.equal(await hasPendingScheduledNewsCacheRevalidation(), true);
  await runScheduledNewsPublisher({ promoteDue: async () => [], revalidate: async () => {} });
  assert.equal(await hasPendingScheduledNewsCacheRevalidation(), false);
});

test('a failed scheduler attempt leaves a retry for the next run', async () => {
  const expected = [{ id: 77 }];
  let attempts = 0;
  const promoteDue = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary database failure');
    return expected;
  };

  await assert.rejects(() => runScheduledNewsPublisher({ promoteDue }), /temporary database failure/);
  const retried = await runScheduledNewsPublisher({ promoteDue });
  assert.equal(attempts, 2);
  assert.equal(retried, expected);
});

test('cache revalidation retries on the next tick without republishing posts', async () => {
  const expected = [{ id: 88 }];
  let promotionCalls = 0;
  let revalidationCalls = 0;
  const promoteDue = async () => (promotionCalls++ === 0 ? expected : []);
  const revalidate = async () => {
    revalidationCalls += 1;
    if (revalidationCalls === 1) throw new Error('temporary dashboard failure');
  };
  let marked = false;
  const needsRevalidation = async () => !marked;
  const markRevalidated = async () => { marked = true; };

  assert.equal(await runScheduledNewsPublisher({
    promoteDue, revalidate, needsRevalidation, markRevalidated,
  }), expected);
  assert.deepEqual(await runScheduledNewsPublisher({
    promoteDue, revalidate, needsRevalidation, markRevalidated,
  }), []);
  assert.equal(promotionCalls, 2);
  assert.equal(revalidationCalls, 2);
  assert.equal(marked, true);
});

test('a save that reaches the database after its deadline stays published', async () => {
  const post = await scheduledPost('2099-01-01T00:00:00.000Z', 'Race-safe post');
  const updated = await updateEwcNewsPost(post.id, {
    gameSlug: 'valorant',
    status: 'scheduled',
    scheduledPublishAt: '2000-01-01T00:00:00.000Z',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Race-safe edit', summary: '', body: 'Edited after the deadline' },
    },
  });

  assert.equal(updated.status, 'published');
  assert.equal(updated.title, 'Race-safe edit');
  assert.ok(updated.publishedAt);
});
