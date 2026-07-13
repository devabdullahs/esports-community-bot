import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-news-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { get } = await import('../src/db/client.js');
const {
  createEwcNewsPost,
  getEwcNewsPostById,
  getPublishedEwcNewsPost,
  listPublishedEwcNewsPosts,
  setEwcNewsPostStatus,
  updateEwcNewsPost,
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

test('rejects XML-invalid control characters before storing feed content', () => {
  const result = validateNewsContentInput({
    status: 'published',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Broken\u0001 title', summary: 'Summary', body: 'Body' },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported control characters/i);
});

test('lists shared posts in both public languages and preserves cover URLs', async () => {
  const post = await createEwcNewsPost({
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

  const arabicList = await listPublishedEwcNewsPosts({ gameSlug: 'valorant', locale: 'ar' });
  const resolved = arabicList.find((item) => item.id === post.id);
  assert.equal(resolved.title, 'Shared update');
  assert.equal(resolved.coverImageUrl, 'https://assets.example.test/cover.jpg');
});

test('canonicalizes legacy public asset cover and avatar URLs', async () => {
  const post = await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    coverImageUrl: 'https://assets.moonbot.info/news/2026-07-02/cover.jpg?size=large',
    authors: [
      {
        discordId: '123456789012345678',
        name: 'Editor',
        avatarUrl: 'https://assets.moonbot.info/avatars/editor.png',
      },
    ],
    translations: {
      en: {
        title: 'Legacy upload',
        summary: '',
        body: 'Body.',
      },
    },
  });

  assert.equal(
    post.coverImageUrl,
    'https://assets.esportscommunity.net/news/2026-07-02/cover.jpg?size=large',
  );
  assert.equal(post.authors[0].avatarUrl, 'https://assets.esportscommunity.net/avatars/editor.png');

  const stored = await get('SELECT cover_image_url FROM ewc_news_posts WHERE id = $1', [post.id]);
  assert.equal(
    stored.cover_image_url,
    'https://assets.esportscommunity.net/news/2026-07-02/cover.jpg?size=large',
  );
});

test('resolves translated posts by requested locale', async () => {
  const post = await createEwcNewsPost({
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

  assert.equal((await getPublishedEwcNewsPost(post.id, 'en')).title, 'English update');
  assert.equal((await getPublishedEwcNewsPost(post.id, 'ar')).title, 'Arabic update');
});

test('setEwcNewsPostStatus publishes a draft and re-drafts it', async () => {
  // Create a draft post with both translations (required for publishing at route layer,
  // but setEwcNewsPostStatus itself does NOT validate — it is a raw DB setter).
  const post = await createEwcNewsPost({
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
  const published = await setEwcNewsPostStatus(post.id, 'published');
  assert.equal(published.status, 'published');
  assert.ok((await getPublishedEwcNewsPost(post.id, 'en')) !== null, 'post visible via getPublishedEwcNewsPost after publish');

  // published_at is set on first publish
  assert.ok(published.publishedAt !== null, 'publishedAt is set when published');

  // Re-draft: should disappear from published listings but still readable by id
  const redrafted = await setEwcNewsPostStatus(post.id, 'draft');
  assert.equal(redrafted.status, 'draft');
  assert.equal(await getPublishedEwcNewsPost(post.id, 'en'), null, 'post hidden after re-draft');
  assert.ok((await getEwcNewsPostById(post.id)) !== null, 'post still readable by id after re-draft');
});

test('setEwcNewsPostStatus on nonexistent id returns null (characterization)', async () => {
  // The function does a raw UPDATE; if changes === 0 it returns null, not an error.
  const result = await setEwcNewsPostStatus(999999, 'published');
  assert.equal(result, null);
});

test('persists and hydrates coverPlacement (roundtrip), defaulting to top', async () => {
  // Explicit non-default placement survives a create -> read roundtrip.
  const bottom = await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    coverImageUrl: 'https://assets.example.test/cover.jpg',
    coverPlacement: 'bottom',
    translations: {
      en: { title: 'Placed bottom', summary: '', body: 'Body.' },
    },
  });
  assert.equal(bottom.coverPlacement, 'bottom');
  assert.equal((await getEwcNewsPostById(bottom.id)).coverPlacement, 'bottom');

  // card-only is preserved too.
  const cardOnly = await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    coverPlacement: 'card-only',
    translations: {
      en: { title: 'Card only', summary: '', body: 'Body.' },
    },
  });
  assert.equal(cardOnly.coverPlacement, 'card-only');

  // Omitting coverPlacement defaults to 'top'.
  const defaulted = await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'No placement', summary: '', body: 'Body.' },
    },
  });
  assert.equal(defaulted.coverPlacement, 'top');

  // Updating switches placement and the change is read back.
  const updated = await updateEwcNewsPost(bottom.id, {
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    coverPlacement: 'card-only',
    translations: {
      en: { title: 'Placed bottom', summary: '', body: 'Body.' },
    },
  });
  assert.equal(updated.coverPlacement, 'card-only');
  assert.equal((await getEwcNewsPostById(bottom.id)).coverPlacement, 'card-only');
});

test('hydrates legacy rows (NULL cover_placement) as top', async () => {
  // Insert a legacy row through the unified client (not the raw sqlite handle) so the
  // fixture lands in whichever backend the reads query — SQLite and Postgres alike.
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const { id } = await get(
    `INSERT INTO ewc_news_posts
      (game_slug, locale, title, summary, body, status, created_at, updated_at)
     VALUES ('legacy-placement', 'en', 'Legacy', '', 'Body', 'draft', $1, $2)
     RETURNING id`,
    [now, now],
  );
  assert.equal((await getEwcNewsPostById(id)).coverPlacement, 'top');
});

test('falls back to legacy columns when translations are missing', async () => {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const { id } = await get(
    `INSERT INTO ewc_news_posts
      (game_slug, locale, title, summary, body, status, created_at, updated_at, published_at)
     VALUES ('legacy-game', 'ar', 'Legacy title', 'Legacy summary', 'Legacy body', 'published', $1, $2, $3)
     RETURNING id`,
    [now, now, now],
  );

  const post = await getEwcNewsPostById(id);
  assert.equal(post.defaultLocale, 'ar');
  assert.equal(post.title, 'Legacy title');
});
