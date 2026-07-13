import { localizedPath, type Locale } from "@/lib/i18n";

type NewsUrlPost = {
  id: number;
  gameSlug: string | null;
  mediaSlug: string | null;
  contentMode: "shared" | "translated";
  defaultLocale: Locale;
  translations: Partial<Record<Locale, { title?: string; body?: string }>>;
};

function completeTranslation(value: { title?: string; body?: string } | undefined) {
  return Boolean(value?.title?.trim() && value?.body?.trim());
}

export function newsBasePath(post: NewsUrlPost) {
  if (post.mediaSlug) return `/media/${post.mediaSlug}/news/${post.id}`;
  if (post.gameSlug) return `/games/${post.gameSlug}/news/${post.id}`;
  return `/news`;
}

export function newsAvailableLocales(post: NewsUrlPost): Locale[] {
  if (post.contentMode === "shared") {
    return completeTranslation(post.translations[post.defaultLocale])
      ? [post.defaultLocale]
      : [];
  }
  return (["en", "ar"] as const).filter((locale) =>
    completeTranslation(post.translations[locale]),
  );
}

export function newsCanonicalLocale(post: NewsUrlPost, requested: Locale): Locale {
  const available = newsAvailableLocales(post);
  if (available.includes(requested)) return requested;
  if (available.includes(post.defaultLocale)) return post.defaultLocale;
  return available[0] ?? post.defaultLocale;
}

export function newsPublicPath(post: NewsUrlPost, locale: Locale) {
  return localizedPath(newsBasePath(post), newsCanonicalLocale(post, locale));
}

export function newsLanguagePaths(post: NewsUrlPost) {
  const base = newsBasePath(post);
  const available = newsAvailableLocales(post);
  const paths: Partial<Record<Locale | "x-default", string>> = {};
  for (const locale of available) paths[locale] = localizedPath(base, locale);
  const fallback = available.includes(post.defaultLocale)
    ? post.defaultLocale
    : available[0];
  if (fallback) paths["x-default"] = localizedPath(base, fallback);
  return paths;
}

export function newsPublicPaths(post: NewsUrlPost) {
  return newsAvailableLocales(post).map((locale) => localizedPath(newsBasePath(post), locale));
}
