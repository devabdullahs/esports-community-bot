export const NEWS_TITLE_MAX_LENGTH = 90;
export const NEWS_SUMMARY_MAX_LENGTH = 180;
export const NEWS_BODY_MAX_LENGTH = 12000;
export const NEWS_CONTENT_MODES = ['shared', 'translated'];
export const NEWS_LOCALES = ['en', 'ar'];
// Where the cover image renders on the public article page. 'top' is the legacy
// behaviour (cover above the body); 'bottom' renders it after the body; 'card-only'
// keeps it off the article entirely (cards/listings still show it).
export const NEWS_COVER_PLACEMENTS = ['top', 'bottom', 'card-only'];
export const DEFAULT_NEWS_COVER_PLACEMENT = 'top';

export function isNewsLocale(value) {
  return value === 'en' || value === 'ar';
}

export function isNewsContentMode(value) {
  return value === 'shared' || value === 'translated';
}

export function isNewsCoverPlacement(value) {
  return value === 'top' || value === 'bottom' || value === 'card-only';
}

export function normalizeNewsTranslation(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    title: typeof source.title === 'string' ? source.title.trim() : '',
    summary: typeof source.summary === 'string' ? source.summary.trim() : '',
    body: typeof source.body === 'string' ? source.body : '',
  };
}

function legacyTranslation(raw) {
  return normalizeNewsTranslation({
    title: raw?.title,
    summary: raw?.summary,
    body: raw?.body,
  });
}

function hasInvalidXmlCharacters(value) {
  for (const character of String(value || '')) {
    const point = character.codePointAt(0) || 0;
    const valid = point === 0x9 || point === 0xa || point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
    if (!valid) return true;
  }
  return false;
}

function validateTranslation(locale, translation, { requirePublishable }) {
  if ([translation.title, translation.summary, translation.body].some(hasInvalidXmlCharacters)) {
    return `${locale.toUpperCase()} content contains unsupported control characters`;
  }
  if (translation.title.length > NEWS_TITLE_MAX_LENGTH) {
    return `${locale.toUpperCase()} headline must be ${NEWS_TITLE_MAX_LENGTH} characters or fewer`;
  }
  if (translation.summary.length > NEWS_SUMMARY_MAX_LENGTH) {
    return `${locale.toUpperCase()} summary must be ${NEWS_SUMMARY_MAX_LENGTH} characters or fewer`;
  }
  if (translation.body.length > NEWS_BODY_MAX_LENGTH) {
    return `${locale.toUpperCase()} body must be ${NEWS_BODY_MAX_LENGTH.toLocaleString('en-US')} characters or fewer`;
  }
  if (requirePublishable && !translation.title.trim()) {
    return `${locale.toUpperCase()} headline is required before publishing`;
  }
  if (requirePublishable && !translation.body.trim()) {
    return `${locale.toUpperCase()} body is required before publishing`;
  }
  return null;
}

export function normalizeNewsContentInput(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = source.status === 'published' ? 'published' : 'draft';
  const contentMode = isNewsContentMode(source.contentMode) ? source.contentMode : 'shared';
  const legacyLocale = isNewsLocale(source.locale) ? source.locale : null;
  const defaultLocale = isNewsLocale(source.defaultLocale)
    ? source.defaultLocale
    : legacyLocale || 'en';
  const rawTranslations =
    source.translations && typeof source.translations === 'object'
      ? source.translations
      : {};
  const translations = {};

  if (contentMode === 'shared') {
    const sharedSource =
      rawTranslations[defaultLocale] ||
      rawTranslations.en ||
      rawTranslations.ar ||
      legacyTranslation(source);
    translations[defaultLocale] = normalizeNewsTranslation(sharedSource);
  } else {
    translations.en = normalizeNewsTranslation(rawTranslations.en);
    translations.ar = normalizeNewsTranslation(rawTranslations.ar);
  }

  return { status, contentMode, defaultLocale, translations };
}

export function validateNewsContentInput(raw = {}) {
  const value = normalizeNewsContentInput(raw);
  const requirePublishable = value.status === 'published';
  const locales = value.contentMode === 'translated' ? NEWS_LOCALES : [value.defaultLocale];

  for (const locale of locales) {
    const error = validateTranslation(locale, value.translations[locale], {
      requirePublishable,
    });
    if (error) return { ok: false, error };
  }

  return { ok: true, value };
}

export function getTranslationForLocale(post, locale) {
  const translations = post?.translations || {};
  const requested = isNewsLocale(locale) ? locale : 'en';
  const fallback = isNewsLocale(post?.defaultLocale) ? post.defaultLocale : 'en';
  return (
    translations[requested] ||
    translations[fallback] ||
    translations.en ||
    translations.ar ||
    null
  );
}

export function resolvePostForLocale(post, locale) {
  const translation = getTranslationForLocale(post, locale);
  if (!post || !translation) return null;
  return {
    ...post,
    locale: isNewsLocale(locale) ? locale : post.defaultLocale,
    title: translation.title,
    summary: translation.summary,
    body: translation.body,
  };
}
