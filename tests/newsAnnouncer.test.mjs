import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'news-announcer-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.EWC_DASHBOARD_PUBLIC_URL = 'https://esportscommunity.net';
const { buildNewsPayload, postNewPublished } = await import('../src/jobs/newsAnnouncer.js');
const { config } = await import('../src/config.js');
const { closeDb } = await import('../src/db/index.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('Arabic Discord previews link directly to the Arabic article with attribution', () => {
  const payload = buildNewsPayload({
    id: 42,
    gameSlug: 'valorant',
    mediaSlug: null,
    defaultLocale: 'en',
    title: 'English',
    summary: 'English summary',
    body: 'English body',
    translations: {
      en: { locale: 'en', title: 'English', summary: 'English summary', body: 'English body' },
      ar: { locale: 'ar', title: 'عنوان', summary: 'ملخص', body: 'محتوى كامل' },
    },
    authors: [],
  });
  const embed = payload.embeds[0].toJSON();
  const url = new URL(embed.url);
  assert.equal(url.pathname, '/ar/games/valorant/news/42');
  assert.equal(url.searchParams.get('utm_source'), 'discord');
  assert.equal(embed.description, 'ملخص');
});

test('a malformed optional dashboard URL degrades to a linkless preview', () => {
  const original = config.dashboard.publicUrl;
  config.dashboard.publicUrl = 'not a URL';
  try {
    const payload = buildNewsPayload({
      id: 7,
      gameSlug: 'valorant',
      defaultLocale: 'en',
      title: 'Update',
      summary: 'Summary',
      body: 'Body',
      translations: {
        en: { locale: 'en', title: 'Update', summary: 'Summary', body: 'Body' },
      },
      authors: [],
    });
    assert.equal(payload.embeds[0].toJSON().url, undefined);
    assert.equal(payload.components, undefined);
  } finally {
    config.dashboard.publicUrl = original;
  }
});

test('a post unpublished after the candidate snapshot is not sent', async () => {
  let sends = 0;
  let records = 0;
  await postNewPublished({}, {
    listCandidates: async () => [{ post_id: 91, game_slug: 'valorant', media_slug: null }],
    resolvePostChannel: async () => ({
      guildId: 'guild',
      channel: {
        id: 'channel',
        send: async () => {
          sends += 1;
          return { id: 'message' };
        },
      },
    }),
    getPost: async () => ({ id: 91, status: 'draft' }),
    getGame: async () => null,
    recordPost: async () => { records += 1; },
  });

  assert.equal(sends, 0);
  assert.equal(records, 0);
});
