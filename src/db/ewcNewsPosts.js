import { db } from './index.js';
import {
  getTranslationForLocale,
  isNewsContentMode,
  isNewsCoverPlacement,
  isNewsLocale,
  resolvePostForLocale,
} from '../lib/ewcNewsContent.js';

function hydrateTranslation(row) {
  return {
    locale: row.locale,
    title: row.title,
    summary: row.summary,
    body: row.body,
  };
}

function translationsForPost(id) {
  const rows = db
    .prepare(
      `SELECT locale, title, summary, body
       FROM ewc_news_post_translations
       WHERE post_id = ?
       ORDER BY locale`,
    )
    .all(id);
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

function hydrate(row, locale) {
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
    translations: translationsForPost(row.id),
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

function replaceTranslations(id, translations) {
  db.prepare('DELETE FROM ewc_news_post_translations WHERE post_id = ?').run(id);
  const insert = db.prepare(
    `INSERT INTO ewc_news_post_translations
       (post_id, locale, title, summary, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  );
  for (const translation of Object.values(translations)) {
    insert.run(
      id,
      translation.locale,
      translation.title,
      translation.summary,
      translation.body,
    );
  }
}

function syncLegacyColumns(id, input) {
  const fallback = legacyTranslation(input);
  db.prepare(
    `UPDATE ewc_news_posts
     SET locale = ?, title = ?, summary = ?, body = ?
     WHERE id = ?`,
  ).run(fallback.locale, fallback.title, fallback.summary, fallback.body, id);
}

export function getEwcNewsPostById(id) {
  return hydrate(db.prepare('SELECT * FROM ewc_news_posts WHERE id = ?').get(id));
}

export function getPublishedEwcNewsPost(id, locale = 'en') {
  return hydrate(
    db.prepare("SELECT * FROM ewc_news_posts WHERE id = ? AND status = 'published'").get(id),
    locale,
  );
}

export function listEwcNewsPostsForAdmin({ gameSlug = null, status = null } = {}) {
  let rows;
  if (gameSlug && status) {
    rows = db
      .prepare('SELECT * FROM ewc_news_posts WHERE game_slug = ? AND status = ? ORDER BY updated_at DESC, id DESC')
      .all(gameSlug, status);
  } else if (gameSlug) {
    rows = db
      .prepare('SELECT * FROM ewc_news_posts WHERE game_slug = ? ORDER BY updated_at DESC, id DESC')
      .all(gameSlug);
  } else if (status) {
    rows = db
      .prepare('SELECT * FROM ewc_news_posts WHERE status = ? ORDER BY updated_at DESC, id DESC')
      .all(status);
  } else {
    rows = db.prepare('SELECT * FROM ewc_news_posts ORDER BY updated_at DESC, id DESC').all();
  }
  return rows.map((row) => hydrate(row));
}

export function listPublishedEwcNewsPosts({ gameSlug, locale }) {
  return db
    .prepare(
      `SELECT * FROM ewc_news_posts
       WHERE game_slug = ? AND status = 'published'
       ORDER BY published_at DESC, id DESC`,
    )
    .all(gameSlug)
    .map((row) => hydrate(row, locale))
    .filter(Boolean);
}

export function listLatestPublishedEwcNewsPosts({ locale, limit = 4 } = {}) {
  return db
    .prepare(
      `SELECT * FROM ewc_news_posts
       WHERE status = 'published'
       ORDER BY published_at DESC, id DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(20, Number(limit) || 4)))
    .map((row) => hydrate(row, locale))
    .filter(Boolean);
}

export function createEwcNewsPost(input) {
  const tx = db.transaction((raw) => {
    const value = normalizeInput(raw);
    const fallback = legacyTranslation(value);
    const info = db
      .prepare(
        `INSERT INTO ewc_news_posts
           (game_slug, locale, content_mode, default_locale, title, summary, body, status,
            author_discord_id, author_name, cover_image_url, cover_placement,
            created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'),
            CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`,
      )
      .run(
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
        value.status || 'draft',
      );
    const id = info.lastInsertRowid;
    replaceTranslations(id, value.translations);
    syncLegacyColumns(id, value);
    return id;
  });
  return getEwcNewsPostById(tx(input));
}

export function updateEwcNewsPost(id, input) {
  const tx = db.transaction((postId, raw) => {
    const value = normalizeInput(raw);
    const fallback = legacyTranslation(value);
    const info = db
      .prepare(
        `UPDATE ewc_news_posts
         SET game_slug = ?, locale = ?, content_mode = ?, default_locale = ?, title = ?,
             summary = ?, body = ?, status = ?, cover_image_url = ?, cover_placement = ?,
             author_discord_id = COALESCE(?, author_discord_id),
             author_name = COALESCE(?, author_name),
             updated_at = datetime('now'),
             published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)
         WHERE id = ?`,
      )
      .run(
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
        value.status || 'draft',
        postId,
      );
    if (info.changes === 0) return null;
    replaceTranslations(postId, value.translations);
    syncLegacyColumns(postId, value);
    return postId;
  });
  const updatedId = tx(id, input);
  return updatedId === null ? null : getEwcNewsPostById(updatedId);
}

export function setEwcNewsPostStatus(id, status) {
  const info = db
    .prepare(
      `UPDATE ewc_news_posts
       SET status = ?, updated_at = datetime('now'),
           published_at = COALESCE(published_at, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)
       WHERE id = ?`,
    )
    .run(status, status, id);
  if (info.changes === 0) return null;
  return getEwcNewsPostById(id);
}

export function deleteEwcNewsPost(id) {
  const tx = db.transaction((postId) => {
    db.prepare('DELETE FROM ewc_news_post_translations WHERE post_id = ?').run(postId);
    return db.prepare('DELETE FROM ewc_news_posts WHERE id = ?').run(postId);
  });
  return tx(id);
}
