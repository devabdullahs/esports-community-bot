import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNewsCanonicalUrl,
  buildNewsCrossPostPreview,
  buildNewsDiscordAnnouncementPreview,
} from '../src/lib/newsCrossPost.js';

const POST = {
  id: 42,
  gameSlug: 'valorant',
  mediaSlug: null,
  defaultLocale: 'en',
  translations: {
    en: { locale: 'en', title: 'Final result', summary: 'A clean win', body: 'Body' },
    ar: { locale: 'ar', title: 'النتيجة النهائية', summary: 'فوز مستحق', body: 'المحتوى' },
  },
};

test('cross-post preview uses the requested translation and canonical public route', () => {
  const preview = buildNewsCrossPostPreview(POST, {
    baseUrl: 'https://esportscommunity.net/internal/ignored',
    preferredLocale: 'ar',
  });
  assert.equal(preview.locale, 'ar');
  assert.equal(preview.title, 'النتيجة النهائية');
  assert.equal(preview.canonicalUrl, 'https://esportscommunity.net/ar/games/valorant/news/42');
  const discord = new URL(preview.discordUrl);
  assert.equal(discord.searchParams.get('utm_source'), 'discord');
  assert.equal(discord.searchParams.get('utm_campaign'), 'news_announcement');
});

test('X draft contains only public title and tracked canonical URL', () => {
  const preview = buildNewsCrossPostPreview({ ...POST, mediaSlug: 'echo', gameSlug: null }, {
    baseUrl: 'https://esportscommunity.net',
    preferredLocale: 'en',
  });
  const intent = new URL(preview.xIntentUrl);
  const text = intent.searchParams.get('text');
  assert.match(text, /^Final result/);
  assert.match(text, /https:\/\/esportscommunity\.net\/media\/echo\/news\/42/);
  assert.match(text, /utm_source=x/);
  assert.doesNotMatch(text, /discord|token|secret/i);
});

test('X draft accepts safe optional hashtags and encodes its local intent URL', () => {
  const preview = buildNewsCrossPostPreview(POST, {
    baseUrl: 'https://esportscommunity.net',
    preferredLocale: 'en',
    hashtags: ['EWC', '#Valorant', 'not-a-tag!', 'EWC'],
  });
  assert.deepEqual(preview.hashtags, ['#EWC', '#Valorant']);
  assert.match(preview.socialText, /#EWC #Valorant/);
  assert.equal(new URL(preview.xIntentUrl).hostname, 'twitter.com');
});

test('Discord preview keeps the announcer payload fields in one pure, public-only model', () => {
  const preview = buildNewsDiscordAnnouncementPreview(
    {
      ...POST,
      coverImageUrl: 'https://assets.esportscommunity.net/news/cover.jpg',
      authors: [
        { name: 'Writer', avatarUrl: 'https://cdn.example.test/writer.png' },
        { name: 'Editor', avatarUrl: 'javascript:alert(1)' },
      ],
      publishedAt: '2026-07-17 12:00:00',
    },
    {
      baseUrl: 'https://esportscommunity.net',
      game: { title: { ar: 'Valorant', en: 'VALORANT' } },
    },
  );
  assert.equal(preview.locale, 'ar');
  assert.equal(preview.url, 'https://esportscommunity.net/ar/games/valorant/news/42?utm_source=discord&utm_medium=community&utm_campaign=news_announcement');
  assert.equal(preview.description, '\u0641\u0648\u0632 \u0645\u0633\u062a\u062d\u0642');
  assert.equal(preview.imageUrl, 'https://assets.esportscommunity.net/news/cover.jpg');
  assert.equal(preview.byline, 'Writer, Editor');
  assert.equal(preview.authorIconUrl, 'https://cdn.example.test/writer.png');
  assert.equal(preview.footer, 'Valorant');
  assert.equal(preview.readMoreLabel, 'Read more');
  assert.equal(preview.timestamp, Date.parse('2026-07-17T12:00:00Z'));
});

test('canonical builder fails closed for invalid origins or ownerless posts', () => {
  assert.equal(buildNewsCanonicalUrl(POST, { baseUrl: 'javascript:alert(1)' }), null);
  assert.equal(buildNewsCanonicalUrl({ id: 1 }, { baseUrl: 'https://example.com' }), null);
});
