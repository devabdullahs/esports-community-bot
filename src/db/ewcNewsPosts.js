import { all, get, run, transaction } from './client.js';
import {
  getTranslationForLocale,
  isNewsContentMode,
  isNewsCoverPlacement,
  isNewsLocale,
  resolvePostForLocale,
} from '../lib/ewcNewsContent.js';

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function hydrateTranslation(row) {
  return {
    locale: row.locale,
    title: row.title,
    summary: row.summary,
    body: row.body,
  };
}

async function translationsForPost(id) {
  const rows = await all(
    `SELECT locale, title, summary, body
     FROM ewc_news_post_translations
     WHERE post_id = $1
     ORDER BY locale`,
    [id],
  );
  return Object.fromEntries(rows.map((row) => [row.locale, hydrateTranslation(row)]));
}

function withResolvedFields(post, locale = post?.defaultLocale || 'en') {
  const resolved = resolvePostForLocale(post, locale);
  if (resolved) return resolved;
  return {
    ...post,
    locale: locale || 'en',
    title: '',
    summary: '',
    body: '',
  };
}

async function hydrate(row, locale) {
  if (!row) return null;
  const post = {
    id: row.id,
    gameSlug: row.game_slug,
    contentMode: row.content_mode || 'shared',
    defaultLocale: row.default_locale || row.locale || 'en',
    status: row.status,
    authorDiscordId: row.author_discord_id,
    authorName: row.author_name,
    coverImageUrl: row.cover_image_url,
    coverPlacement: isNewsCoverPlacement(row.cover_placement) ? row.cover_placement : 'top',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    translations: await translationsForPost(row.id),
  };

  if (Object.keys(post.translations).length === 0) {
    const legacyLocale = isNewsLocale(row.locale) ? row.locale : post.defaultLocale;
    post.defaultLocale = legacyLocale;
    post.translations[legacyLocale] = {
      locale: legacyLocale,
      title: row.title || '',
      summary: row.summary || '',
      body: row.body || '',
    };
  }

  return withResolvedFields(post, locale || post.defaultLocale);
}

function normalizeInput(input) {
  const contentMode = isNewsContentMode(input.contentMode) ? input.contentMode : 'shared';
  const defaultLocale = isNewsLocale(input.defaultLocale)
    ? input.defaultLocale
    : isNewsLocale(input.locale)
      ? input.locale
      : 'en';
  const sourceTranslations =
    input.translations && typeof input.translations === 'object' ? input.translations : null;
  const translations = {};

  if (sourceTranslations) {
    for (const locale of ['en', 'ar']) {
      const item = sourceTranslations[locale];
      if (!item) continue;
      translations[locale] = {
        locale,
        title: typeof item.title === 'string' ? item.title : '',
        summary: typeof item.summary === 'string' ? item.summary : '',
        body: typeof item.body === 'string' ? item.body : '',
      };
    }
  } else {
    translations[defaultLocale] = {
      locale: defaultLocale,
      title: typeof input.title === 'string' ? input.title : '',
      summary: typeof input.summary === 'string' ? input.summary : '',
      body: typeof input.body === 'string' ? input.body : '',
    };
  }

  if (contentMode === 'shared') {
    const shared = translations[defaultLocale] || translations.en || translations.ar || {
      locale: defaultLocale,
      title: '',
      summary: '',
      body: '',
    };
    return {
      ...input,
      contentMode,
      defaultLocale,
      translations: {
        [defaultLocale]: { ...shared, locale: defaultLocale },
      },
    };
  }

  return {
    ...input,
    contentMode,
    defaultLocale,
    translations: {
      en: translations.en || { locale: 'en', title: '', summary: '', body: '' },
      ar: translations.ar || { locale: 'ar', title: '', summary: '', body: '' },
    },
  };
}

function legacyTranslation(input) {
  return (
    getTranslationForLocale(input, input.defaultLocale) ||
    input.translations.en ||
    input.translations.ar ||
    { locale: input.defaultLocale, title: '', summary: '', body: '' }
  );
}

async function replaceTranslations(id, translations, client) {
  await client.run('DELETE FROM ewc_news_post_translations WHERE post_id = $1', [id]);
  const now = nowText();
  for (const translation of Object.values(translations)) {
    await client.run(
      `INSERT INTO ewc_news_post_translations
         (post_id, locale, title, summary, body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, translation.locale, translation.title, translation.summary, translation.body, now, now],
    );
  }
}

async function syncLegacyColumns(id, input, client) {
  const fallback = legacyTranslation(input);
  await client.run(
    `UPDATE ewc_news_posts
     SET locale = $1, title = $2, summary = $3, body = $4
     WHERE id = $5`,
    [fallback.locale, fallback.title, fallback.summary, fallback.body, id],
  );
}

export async function getEwcNewsPostById(id) {
  return hydrate(await get('SELECT * FROM ewc_news_posts WHERE id = $1', [id]));
}

export async function getPublishedEwcNewsPost(id, locale = 'en') {
  return hydrate(await get("SELECT * FROM ewc_news_posts WHERE id = $1 AND status = 'published'", [id]), locale);
}

export async function listEwcNewsPostsForAdmin({ gameSlug = null, status = null } = {}) {
  let rows;
  if (gameSlug && status) {
    rows = await all('SELECT * FROM ewc_news_posts WHERE game_slug = $1 AND status = $2 ORDER BY updated_at DESC, id DESC', [
      gameSlug,
      status,
    ]);
  } else if (gameSlug) {
    rows = await all('SELECT * FROM ewc_news_posts WHERE game_slug = $1 ORDER BY updated_at DESC, id DESC', [gameSlug]);
  } else if (status) {
    rows = await all('SELECT * FROM ewc_news_posts WHERE status = $1 ORDER BY updated_at DESC, id DESC', [status]);
  } else {
    rows = await all('SELECT * FROM ewc_news_posts ORDER BY updated_at DESC, id DESC');
  }
  return Promise.all(rows.map((row) => hydrate(row)));
}

export async function listPublishedEwcNewsPosts({ gameSlug, locale }) {
  const rows = await all(
    `SELECT * FROM ewc_news_posts
     WHERE game_slug = $1 AND status = 'published'
     ORDER BY published_at DESC, id DESC`,
    [gameSlug],
  );
  return (await Promise.all(rows.map((row) => hydrate(row, locale)))).filter(Boolean);
}

export async function listLatestPublishedEwcNewsPosts({ locale, limit = 4 } = {}) {
  const rows = await all(
    `SELECT * FROM ewc_news_posts
     WHERE status = 'published'
     ORDER BY published_at DESC, id DESC
     LIMIT $1`,
    [Math.max(1, Math.min(20, Number(limit) || 4))],
  );
  return (await Promise.all(rows.map((row) => hydrate(row, locale)))).filter(Boolean);
}

export async function createEwcNewsPost(input) {
  const id = await transaction(async (tx) => {
    const value = normalizeInput(input);
    const fallback = legacyTranslation(value);
    const now = nowText();
    const row = await tx.get(
      `INSERT INTO ewc_news_posts
         (game_slug, locale, content_mode, default_locale, title, summary, body, status,
          author_discord_id, author_name, cover_image_url, cover_placement,
          created_at, updated_at, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        value.gameSlug,
        fallback.locale,
        value.contentMode,
        value.defaultLocale,
        fallback.title,
        fallback.summary,
        fallback.body,
        value.status || 'draft',
        value.authorDiscordId || null,
        value.authorName || null,
        value.coverImageUrl || null,
        isNewsCoverPlacement(value.coverPlacement) ? value.coverPlacement : 'top',
        now,
        now,
        value.status === 'published' ? now : null,
      ],
    );
    await replaceTranslations(row.id, value.translations, tx);
    await syncLegacyColumns(row.id, value, tx);
    return row.id;
  });
  return getEwcNewsPostById(id);
}

export async function updateEwcNewsPost(id, input) {
  const updatedId = await transaction(async (tx) => {
    const value = normalizeInput(input);
    const fallback = legacyTranslation(value);
    const now = nowText();
    const info = await tx.run(
      `UPDATE ewc_news_posts
       SET game_slug = $1, locale = $2, content_mode = $3, default_locale = $4, title = $5,
           summary = $6, body = $7, status = $8, cover_image_url = $9, cover_placement = $10,
           author_discord_id = COALESCE($11, author_discord_id),
           author_name = COALESCE($12, author_name),
           updated_at = $13,
           published_at = COALESCE(published_at, $14)
       WHERE id = $15`,
      [
        value.gameSlug,
        fallback.locale,
        value.contentMode,
        value.defaultLocale,
        fallback.title,
        fallback.summary,
        fallback.body,
        value.status || 'draft',
        value.coverImageUrl || null,
        isNewsCoverPlacement(value.coverPlacement) ? value.coverPlacement : 'top',
        value.authorDiscordId || null,
        value.authorName || null,
        now,
        value.status === 'published' ? now : null,
        id,
      ],
    );
    if (info.changes === 0) return null;
    await replaceTranslations(id, value.translations, tx);
    await syncLegacyColumns(id, value, tx);
    return id;
  });
  return updatedId === null ? null : getEwcNewsPostById(updatedId);
}

export async function setEwcNewsPostStatus(id, status) {
  const now = nowText();
  const info = await run(
    `UPDATE ewc_news_posts
     SET status = $1, updated_at = $2,
         published_at = COALESCE(published_at, $3)
     WHERE id = $4`,
    [status, now, status === 'published' ? now : null, id],
  );
  if (info.changes === 0) return null;
  return getEwcNewsPostById(id);
}

export async function deleteEwcNewsPost(id) {
  return transaction(async (tx) => {
    await tx.run('DELETE FROM ewc_news_post_translations WHERE post_id = $1', [id]);
    return tx.run('DELETE FROM ewc_news_posts WHERE id = $1', [id]);
  });
}
