import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-news-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb, db } = await import('../src/db/index.js');
const {
  createEwcNewsPost,
  getEwcNewsPostById,
  getPublishedEwcNewsPost,
  listPublishedEwcNewsPosts,
  setEwcNewsPostStatus,
} = await import('../src/db/ewcNewsPosts.js');
const {
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
  validateNewsContentInput,
} = await import('../src/lib/ewcNewsContent.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('validates title and summary limits on news content', () => {
  const titleResult = validateNewsContentInput({
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: {
        title: 'x'.repeat(NEWS_TITLE_MAX_LENGTH + 1),
        summary: '',
        body: '',
      },
    },
  });
  assert.equal(titleResult.ok, false);
  assert.match(titleResult.error, /headline/);

  const summaryResult = validateNewsContentInput({
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: {
        title: 'Short',
        summary: 'x'.repeat(NEWS_SUMMARY_MAX_LENGTH + 1),
        body: '',
      },
    },
  });
  assert.equal(summaryResult.ok, false);
  assert.match(summaryResult.error, /summary/);
});

test('requires both translations before publishing translated posts', () => {
  const draft = validateNewsContentInput({
    status: 'draft',
    contentMode: 'translated',
    defaultLocale: 'en',
    translations: {
      en: { title: 'English title', summary: '', body: 'English body' },
    },
  });
  assert.equal(draft.ok, true);

  const published = validateNewsContentInput({
    status: 'published',
    contentMode: 'translated',
    defaultLocale: 'en',
    translations: {
      en: { title: 'English title', summary: '', body: 'English body' },
    },
  });
  assert.equal(published.ok, false);
  assert.match(published.error, /AR/);
});

test('lists shared posts in both public languages and preserves cover URLs', () => {
  const post = createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'published',
    contentMode: 'shared',
    defaultLocale: 'en',
    coverImageUrl: 'https://assets.example.test/cover.jpg',
    translations: {
      en: {
        title: 'Shared update',
        summary: 'A compact public summary.',
        body: 'Full public body.',
      },
    },
  });

  const arabicList = listPublishedEwcNewsPosts({ gameSlug: 'valorant', locale: 'ar' });
  const resolved = arabicList.find((item) => item.id === post.id);
  assert.equal(resolved.title, 'Shared update');
  assert.equal(resolved.coverImageUrl, 'https://assets.example.test/cover.jpg');
});

test('resolves translated posts by requested locale', () => {
  const post = createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'published',
    contentMode: 'translated',
    defaultLocale: 'en',
    translations: {
      en: {
        title: 'English update',
        summary: 'English summary.',
        body: 'English body.',
      },
      ar: {
        title: 'Arabic update',
        summary: 'Arabic summary.',
        body: 'Arabic body.',
      },
    },
  });

  assert.equal(getPublishedEwcNewsPost(post.id, 'en').title, 'English update');
  assert.equal(getPublishedEwcNewsPost(post.id, 'ar').title, 'Arabic update');
});

test('setEwcNewsPostStatus publishes a draft and re-drafts it', () => {
  // Create a draft post with both translations (required for publishing at route layer,
  // but setEwcNewsPostStatus itself does NOT validate — it is a raw DB setter).
  const post = createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'translated',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Status test EN', summary: 'EN summary', body: 'EN body' },
      ar: { title: 'Status test AR', summary: 'AR summary', body: 'AR body' },
    },
  });
  assert.equal(post.status, 'draft');

  // Publish: should now appear in getPublishedEwcNewsPost
  const published = setEwcNewsPostStatus(post.id, 'published');
  assert.equal(published.status, 'published');
  assert.ok(getPublishedEwcNewsPost(post.id, 'en') !== null, 'post visible via getPublishedEwcNewsPost after publish');

  // published_at is set on first publish
  assert.ok(published.publishedAt !== null, 'publishedAt is set when published');

  // Re-draft: should disappear from published listings but still readable by id
  const redrafted = setEwcNewsPostStatus(post.id, 'draft');
  assert.equal(redrafted.status, 'draft');
  assert.equal(getPublishedEwcNewsPost(post.id, 'en'), null, 'post hidden after re-draft');
  assert.ok(getEwcNewsPostById(post.id) !== null, 'post still readable by id after re-draft');
});

test('setEwcNewsPostStatus on nonexistent id returns null (characterization)', () => {
  // The function does a raw UPDATE; if changes === 0 it returns null, not an error.
  const result = setEwcNewsPostStatus(999999, 'published');
  assert.equal(result, null);
});

test('falls back to legacy columns when translations are missing', () => {
  const info = db.prepare(
    `INSERT INTO ewc_news_posts
      (game_slug, locale, title, summary, body, status, created_at, updated_at, published_at)
     VALUES ('legacy-game', 'ar', 'Legacy title', 'Legacy summary', 'Legacy body', 'published',
      datetime('now'), datetime('now'), datetime('now'))`,
  ).run();

  const post = getEwcNewsPostById(info.lastInsertRowid);
  assert.equal(post.defaultLocale, 'ar');
  assert.equal(post.title, 'Legacy title');
});
