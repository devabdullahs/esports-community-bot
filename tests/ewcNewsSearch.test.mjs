import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-news-search-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { createEwcNewsPost, searchPublishedEwcNewsPosts } = await import('../src/db/ewcNewsPosts.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('public news search finds old translated posts and excludes drafts', async () => {
  await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'published',
    contentMode: 'translated',
    defaultLocale: 'en',
    ewc: true,
    translations: {
      en: { title: 'Archive needle sentinel', summary: 'old result', body: 'Needle from the archive.' },
      ar: { title: '\u062e\u0628\u0631 \u0623\u0631\u0634\u064a\u0641\u064a', summary: '\u0646\u062a\u064a\u062c\u0629 \u0642\u062f\u064a\u0645\u0629', body: '\u0625\u0628\u0631\u0629 \u0645\u0646 \u0627\u0644\u0623\u0631\u0634\u064a\u0641.' },
    },
  });
  await createEwcNewsPost({
    gameSlug: 'valorant',
    status: 'draft',
    contentMode: 'shared',
    defaultLocale: 'en',
    translations: {
      en: { title: 'Secret archive needle', summary: '', body: 'draft only' },
    },
  });
  for (let index = 0; index < 55; index += 1) {
    await createEwcNewsPost({
      gameSlug: index % 2 ? 'dota2' : 'valorant',
      status: 'published',
      contentMode: 'shared',
      defaultLocale: 'en',
      translations: {
        en: { title: `Newer post ${index}`, summary: '', body: 'Recent filler.' },
      },
    });
  }

  const english = await searchPublishedEwcNewsPosts({
    query: 'archive needle',
    locale: 'en',
    gameSlug: 'valorant',
    ewcOnly: true,
    limit: 10,
  });
  assert.deepEqual(english.map((post) => post.title), ['Archive needle sentinel']);

  const arabic = await searchPublishedEwcNewsPosts({
    query: '\u0625\u0628\u0631\u0629',
    locale: 'ar',
    gameSlug: 'valorant',
  });
  assert.deepEqual(arabic.map((post) => post.locale), ['ar']);
});

test('public news search uses stable pagination', async () => {
  const first = await searchPublishedEwcNewsPosts({ locale: 'en', limit: 10, offset: 0 });
  const second = await searchPublishedEwcNewsPosts({ locale: 'en', limit: 10, offset: 10 });
  assert.equal(first.length, 10);
  assert.equal(second.length, 10);
  assert.equal(first.some((post) => second.some((other) => other.id === post.id)), false);
});
