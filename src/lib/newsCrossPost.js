import { getTranslationForLocale } from './ewcNewsContent.js';
import {
  clampText,
  prepareBodyForDiscord,
  DISCORD_AUTHOR_CAP,
  DISCORD_FOOTER_CAP,
  DISCORD_TITLE_CAP,
} from './discordContent.js';

const DISCORD_TRACKING = {
  utm_source: 'discord',
  utm_medium: 'community',
  utm_campaign: 'news_announcement',
};

const X_TRACKING = {
  utm_source: 'x',
  utm_medium: 'social',
  utm_campaign: 'news_share',
};

function safeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveTranslation(post, preferredLocale) {
  const requestedLocale = preferredLocale === 'ar' ? 'ar' : 'en';
  const directTranslation = post?.translations?.[requestedLocale];
  if (directTranslation) {
    return {
      locale: directTranslation.locale === 'ar' || directTranslation.locale === 'en'
        ? directTranslation.locale
        : requestedLocale,
      translation: directTranslation,
    };
  }

  const translation = getTranslationForLocale(post, requestedLocale);
  const localeFromTranslation = translation?.locale;
  const localeFromPost = post?.defaultLocale === 'ar' || post?.defaultLocale === 'en'
    ? post.defaultLocale
    : post?.locale === 'ar' || post?.locale === 'en'
      ? post.locale
      : 'en';
  return {
    locale: localeFromTranslation === 'ar' || localeFromTranslation === 'en'
      ? localeFromTranslation
      : localeFromPost,
    translation,
  };
}

function addTracking(url, tracking) {
  if (!url) return null;
  const tracked = new URL(url);
  for (const [key, value] of Object.entries(tracking)) tracked.searchParams.set(key, value);
  return tracked.toString();
}

function normalizedHashtags(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  const hashtags = [];
  for (const rawValue of rawValues) {
    const tag = String(rawValue || '').trim().replace(/^#/, '');
    if (!tag || !/^[\p{L}\p{N}_]+$/u.test(tag)) continue;
    const normalized = `#${tag}`;
    if (!hashtags.includes(normalized)) hashtags.push(normalized);
  }
  return hashtags;
}

function publishedTimestamp(value) {
  const timestamp =
    typeof value === 'number'
      ? value * 1000
      : value
        ? Date.parse(`${value}Z`.replace(/Z+$/, 'Z'))
        : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildXIntentUrl(text) {
  const draft = typeof text === 'string' ? text.trim() : '';
  return draft ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(draft)}` : null;
}

export function getNewsCrossPostWebsiteState(post) {
  if (!post?.id) return 'unsaved';
  if (post.status === 'published') return 'published';
  if (post.status === 'scheduled') return 'scheduled';
  return 'draft';
}

export function buildNewsCanonicalUrl(post, { baseUrl, locale = null, tracking = null } = {}) {
  const origin = safeBaseUrl(baseUrl);
  if (!origin || !post?.id) return null;
  const owner = post.mediaSlug
    ? `/media/${encodeURIComponent(post.mediaSlug)}`
    : post.gameSlug
      ? `/games/${encodeURIComponent(post.gameSlug)}`
      : null;
  if (!owner) return null;

  const resolvedLocale = locale || post.defaultLocale || post.locale || 'en';
  const prefix = resolvedLocale === 'ar' ? '/ar' : '';
  const url = new URL(`${prefix}${owner}/news/${encodeURIComponent(String(post.id))}`, origin);
  if (tracking && typeof tracking === 'object') {
    for (const [key, value] of Object.entries(tracking)) {
      if (/^utm_[a-z_]+$/.test(key) && typeof value === 'string' && value) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

/**
 * @param {object} post
 * @param {{ baseUrl?: string, game?: { title?: { ar?: string, en?: string } } | null }} options
 */
export function buildNewsDiscordAnnouncementPreview(post, { baseUrl, game = null } = {}) {
  const { locale, translation } = resolveTranslation(post, 'ar');
  const title = clampText(translation?.title || post?.title || 'News update', DISCORD_TITLE_CAP);
  const summary = prepareBodyForDiscord(translation?.summary || post?.summary || '');
  const bodyLead = prepareBodyForDiscord(translation?.body || '');
  const description = clampText(summary || bodyLead, 600);
  const url = buildNewsCanonicalUrl(post, {
    baseUrl,
    locale,
    tracking: DISCORD_TRACKING,
  });
  const authors = Array.isArray(post?.authors) ? post.authors.filter((author) => author?.name) : [];
  const byline = authors.length
    ? authors.map((author) => author.name).join(', ')
    : post?.authorName || null;
  const authorIconUrl = authors.find((author) => isSafeHttpUrl(author.avatarUrl))?.avatarUrl || null;
  const gameName = game?.title?.ar || game?.title?.en || null;

  return {
    locale,
    title,
    description,
    url,
    imageUrl: isSafeHttpUrl(post?.coverImageUrl) ? post.coverImageUrl : null,
    byline: byline ? clampText(byline, DISCORD_AUTHOR_CAP) : null,
    authorIconUrl,
    footer: gameName ? clampText(gameName, DISCORD_FOOTER_CAP) : null,
    timestamp: publishedTimestamp(post?.publishedAt),
    readMoreLabel: 'Read more',
  };
}

/**
 * @param {object} post
 * @param {{ baseUrl?: string, preferredLocale?: 'ar' | 'en', hashtags?: string | string[] }} options
 */
export function buildNewsCrossPostPreview(
  post,
  { baseUrl, preferredLocale = 'ar', hashtags = [] } = {},
) {
  const { locale, translation } = resolveTranslation(post, preferredLocale);
  const sourceTitle = String(translation?.title || post?.title || '').trim();
  const title = sourceTitle || 'News update';
  const summary = String(translation?.summary || post?.summary || translation?.body || post?.body || '').trim();
  const canonicalUrl = buildNewsCanonicalUrl(post, { baseUrl, locale });
  const discordUrl = addTracking(canonicalUrl, DISCORD_TRACKING);
  const xUrl = addTracking(canonicalUrl, X_TRACKING);
  const tags = normalizedHashtags(hashtags);
  const socialText = sourceTitle
    ? [title, tags.length ? tags.join(' ') : null, xUrl].filter(Boolean).join('\n\n')
    : '';

  return {
    locale,
    title,
    summary,
    coverImageUrl: typeof post?.coverImageUrl === 'string' ? post.coverImageUrl : '',
    canonicalUrl,
    discordUrl,
    xUrl,
    hashtags: tags,
    socialText,
    xIntentUrl: buildXIntentUrl(socialText),
  };
}
