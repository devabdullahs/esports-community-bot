import { all, get, run, transaction } from './client.js';
import {
  getTranslationForLocale,
  isNewsContentMode,
  isNewsCoverPlacement,
  isNewsLocale,
  resolvePostForLocale,
} from '../lib/ewcNewsContent.js';
import { canonicalPublicAssetUrl } from '../lib/publicAssets.js';

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

function nullablePublicAssetUrl(value) {
  return canonicalPublicAssetUrl(value) || null;
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
    gameSlug: row.game_slug || null,
    mediaSlug: row.media_slug || null,
    contentMode: row.content_mode || 'shared',
    defaultLocale: row.default_locale || row.locale || 'en',
    status: row.status,
    authorDiscordId: row.author_discord_id,
    authorName: row.author_name,
    coverImageUrl: nullablePublicAssetUrl(row.cover_image_url),
    coverPlacement: isNewsCoverPlacement(row.cover_placement) ? row.cover_placement : 'top',
    ewc: Boolean(row.ewc),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    translations: await translationsForPost(row.id),
    authors: await authorsForPost(row.id),
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
  const coverImageUrl = nullablePublicAssetUrl(input.coverImageUrl);
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
      coverImageUrl,
      defaultLocale,
      authors: normalizeAuthors(input),
      translations: {
        [defaultLocale]: { ...shared, locale: defaultLocale },
      },
    };
  }

  return {
    ...input,
    contentMode,
    coverImageUrl,
    defaultLocale,
    authors: normalizeAuthors(input),
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

async function authorsForPost(id) {
  const rows = await all(
    `SELECT discord_id, name, avatar_url
     FROM ewc_news_post_authors
     WHERE post_id = $1
     ORDER BY sort_order, discord_id`,
    [id],
  );
  return rows.map((row) => ({
    discordId: row.discord_id,
    name: row.name || '',
    avatarUrl: nullablePublicAssetUrl(row.avatar_url),
  }));
}

// Dedupe + sanitize the incoming authors list. Falls back to a single author
// built from the legacy authorDiscordId/authorName when no list is supplied.
function normalizeAuthors(input) {
  const list = Array.isArray(input.authors) ? input.authors : [];
  const seen = new Set();
  const out = [];
  for (const author of list) {
    const discordId = typeof author?.discordId === 'string' ? author.discordId.trim() : '';
    if (!discordId || seen.has(discordId)) continue;
    seen.add(discordId);
    out.push({
      discordId,
      name: typeof author?.name === 'string' ? author.name : '',
      avatarUrl: nullablePublicAssetUrl(author?.avatarUrl),
    });
  }
  if (out.length === 0 && typeof input.authorDiscordId === 'string' && input.authorDiscordId.trim()) {
    out.push({
      discordId: input.authorDiscordId.trim(),
      name: typeof input.authorName === 'string' ? input.authorName : '',
      avatarUrl: null,
    });
  }
  return out;
}

async function replaceAuthors(id, authors, client) {
  await client.run('DELETE FROM ewc_news_post_authors WHERE post_id = $1', [id]);
  let order = 0;
  for (const author of authors) {
    await client.run(
      `INSERT INTO ewc_news_post_authors (post_id, discord_id, name, avatar_url, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id, discord_id) DO UPDATE SET
         name = excluded.name, avatar_url = excluded.avatar_url, sort_order = excluded.sort_order`,
      [id, author.discordId, author.name, author.avatarUrl, order++],
    );
  }
}

export async function getEwcNewsPostById(id) {
  return hydrate(await get('SELECT * FROM ewc_news_posts WHERE id = $1', [id]));
}

export async function getPublishedEwcNewsPost(id, locale = 'en') {
  return hydrate(await get("SELECT * FROM ewc_news_posts WHERE id = $1 AND status = 'published'", [id]), locale);
}

// Admin list. Filter by game (game-owned posts only), by media channel (its posts),
// or neither (all, for supers). game_slug filters exclude media posts so the game
// admin view stays game-only.
export async function listEwcNewsPostsForAdmin({ gameSlug = null, mediaSlug = null, status = null } = {}) {
  const where = [];
  const params = [];
  if (gameSlug) {
    params.push(gameSlug);
    where.push(`game_slug = $${params.length}`, 'media_slug IS NULL');
  }
  if (mediaSlug) {
    params.push(mediaSlug);
    where.push(`media_slug = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const sql = `SELECT * FROM ewc_news_posts${
    where.length ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY updated_at DESC, id DESC`;
  const rows = await all(sql, params);
  return Promise.all(rows.map((row) => hydrate(row)));
}

// Public game news: only game-owned posts (media posts live on the media page).
export async function listPublishedEwcNewsPosts({ gameSlug, locale }) {
  const rows = await all(
    `SELECT * FROM ewc_news_posts
     WHERE game_slug = $1 AND media_slug IS NULL AND status = 'published'
     ORDER BY published_at DESC, id DESC`,
    [gameSlug],
  );
  return (await Promise.all(rows.map((row) => hydrate(row, locale)))).filter(Boolean);
}

// Global/EWC news feeds: game-owned posts only (media posts are media-page-only).
export async function listLatestPublishedEwcNewsPosts({ locale, limit = 4, ewcOnly = false, offset = 0 } = {}) {
  const rows = await all(
    `SELECT * FROM ewc_news_posts
     WHERE status = 'published' AND media_slug IS NULL${ewcOnly ? ' AND ewc = 1' : ''}
     ORDER BY published_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    // Ceiling is 51 (not 50) so the news hub can request PAGE_SIZE + 1 (51 on the
    // EWC page) to detect a next page via a sentinel row.
    [Math.max(1, Math.min(51, Number(limit) || 4)), Math.max(0, Number(offset) || 0)],
  );
  return (await Promise.all(rows.map((row) => hydrate(row, locale)))).filter(Boolean);
}

// Public media-channel posts: published posts owned by one media channel.
export async function listPublishedMediaPosts({ mediaSlug, locale, limit = 50 } = {}) {
  const rows = await all(
    `SELECT * FROM ewc_news_posts
     WHERE media_slug = $1 AND status = 'published'
     ORDER BY published_at DESC, id DESC
     LIMIT $2`,
    [mediaSlug, Math.max(1, Math.min(100, Number(limit) || 50))],
  );
  return (await Promise.all(rows.map((row) => hydrate(row, locale)))).filter(Boolean);
}

export async function createEwcNewsPostInTx(tx, input) {
  const value = normalizeInput(input);
  const fallback = legacyTranslation(value);
  const primary = value.authors[0] || null;
  const now = nowText();
  const row = await tx.get(
    `INSERT INTO ewc_news_posts
       (game_slug, locale, content_mode, default_locale, title, summary, body, status,
        author_discord_id, author_name, cover_image_url, cover_placement, ewc,
        created_at, updated_at, published_at, media_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [
      value.gameSlug || null,
      fallback.locale,
      value.contentMode,
      value.defaultLocale,
      fallback.title,
      fallback.summary,
      fallback.body,
      value.status || 'draft',
      primary?.discordId || null,
      primary?.name || null,
      value.coverImageUrl || null,
      isNewsCoverPlacement(value.coverPlacement) ? value.coverPlacement : 'top',
      value.ewc ? 1 : 0,
      now,
      now,
      value.status === 'published' ? now : null,
      value.mediaSlug || null,
    ],
  );
  await replaceTranslations(row.id, value.translations, tx);
  await replaceAuthors(row.id, value.authors, tx);
  await syncLegacyColumns(row.id, value, tx);
  return row.id;
}

export async function createEwcNewsPost(input) {
  const id = await transaction((tx) => createEwcNewsPostInTx(tx, input));
  return getEwcNewsPostById(id);
}

export async function updateEwcNewsPost(id, input) {
  const updatedId = await transaction(async (tx) => {
    const value = normalizeInput(input);
    const fallback = legacyTranslation(value);
    const primary = value.authors[0] || null;
    const now = nowText();
    const info = await tx.run(
      `UPDATE ewc_news_posts
       SET game_slug = $1, locale = $2, content_mode = $3, default_locale = $4, title = $5,
           summary = $6, body = $7, status = $8, cover_image_url = $9, cover_placement = $10,
           author_discord_id = $11,
           author_name = $12,
           updated_at = $13,
           published_at = COALESCE(published_at, $14),
           ewc = $15,
           media_slug = $16
       WHERE id = $17`,
      [
        value.gameSlug || null,
        fallback.locale,
        value.contentMode,
        value.defaultLocale,
        fallback.title,
        fallback.summary,
        fallback.body,
        value.status || 'draft',
        value.coverImageUrl || null,
        isNewsCoverPlacement(value.coverPlacement) ? value.coverPlacement : 'top',
        primary?.discordId || null,
        primary?.name || null,
        now,
        value.status === 'published' ? now : null,
        value.ewc ? 1 : 0,
        value.mediaSlug || null,
        id,
      ],
    );
    if (info.changes === 0) return null;
    await replaceTranslations(id, value.translations, tx);
    await replaceAuthors(id, value.authors, tx);
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
    await tx.run('DELETE FROM ewc_news_post_authors WHERE post_id = $1', [id]);
    return tx.run('DELETE FROM ewc_news_posts WHERE id = $1', [id]);
  });
}
