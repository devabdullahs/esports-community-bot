import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ewc-news-offset-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { createEwcNewsPost, listLatestPublishedEwcNewsPosts } = await import('../src/db/ewcNewsPosts.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('listLatestPublishedEwcNewsPosts paginates via limit/offset (disjoint pages)', async () => {
  // Seed three published posts; published_at ordering is DESC so the most recently
  // created lands on page one.
  for (const n of [1, 2, 3]) {
    await createEwcNewsPost({
      gameSlug: 'valorant',
      status: 'published',
      contentMode: 'shared',
      defaultLocale: 'en',
      translations: {
        en: { title: `Offset post ${n}`, summary: '', body: `Body ${n}.` },
      },
    });
  }

  const pageOne = await listLatestPublishedEwcNewsPosts({ locale: 'en', limit: 2, offset: 0 });
  const pageTwo = await listLatestPublishedEwcNewsPosts({ locale: 'en', limit: 2, offset: 2 });

  assert.equal(pageOne.length, 2);
  assert.ok(pageTwo.length >= 1, 'second page returns the remaining post(s)');

  const idsOne = new Set(pageOne.map((p) => p.id));
  const idsTwo = new Set(pageTwo.map((p) => p.id));
  for (const id of idsTwo) {
    assert.ok(!idsOne.has(id), 'page two ids are disjoint from page one ids');
  }
});
