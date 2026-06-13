import "server-only";

// Importing the query module also runs src/db/index.js schema-init (it re-exports `db`
// from connection.js), so the ewc_news_posts table is created on first import.
// The bot's query module is plain JS with no type declarations, so we re-type the
// imported functions at this boundary to get full type-safety in the web app.
import {
  createEwcNewsPost as _create,
  deleteEwcNewsPost as _delete,
  getEwcNewsPostById as _getById,
  getPublishedEwcNewsPost as _getPublished,
  listEwcNewsPostsForAdmin as _listAdmin,
  listLatestPublishedEwcNewsPosts as _listLatest,
  listPublishedEwcNewsPosts as _listPublished,
  setEwcNewsPostStatus as _setStatus,
  updateEwcNewsPost as _update,
} from "@bot/db/ewcNewsPosts.js";
import type { Locale } from "@/lib/i18n";
import { unstable_cache } from "next/cache";

export type NewsStatus = "draft" | "published";
export type NewsContentMode = "shared" | "translated";
export type NewsCoverPlacement = "top" | "bottom" | "card-only";

export type NewsTranslation = {
  locale: Locale;
  title: string;
  summary: string;
  body: string;
};

export type NewsPost = {
  id: number;
  gameSlug: string;
  contentMode: NewsContentMode;
  defaultLocale: Locale;
  locale: Locale;
  title: string;
  summary: string;
  body: string;
  status: NewsStatus;
  authorDiscordId: string | null;
  authorName: string | null;
  coverImageUrl: string | null;
  coverPlacement: NewsCoverPlacement;
  translations: Partial<Record<Locale, NewsTranslation>>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type NewsPostInput = {
  gameSlug: string;
  contentMode: NewsContentMode;
  defaultLocale: Locale;
  translations: Partial<Record<Locale, Omit<NewsTranslation, "locale">>>;
  status?: NewsStatus;
  authorDiscordId?: string | null;
  authorName?: string | null;
  coverImageUrl?: string | null;
  coverPlacement?: NewsCoverPlacement;
};

const getById = _getById as (id: number) => NewsPost | null;
const getPublished = _getPublished as (id: number, locale?: Locale) => NewsPost | null;
const listAdmin = _listAdmin as (filter: {
  gameSlug?: string | null;
  status?: NewsStatus | null;
}) => NewsPost[];
const listPublished = _listPublished as (args: {
  gameSlug: string;
  locale: Locale;
}) => NewsPost[];
const listLatest = _listLatest as (args: { locale: Locale; limit?: number }) => NewsPost[];
const create = _create as (input: NewsPostInput) => NewsPost;
const update = _update as (
  id: number,
  input: Omit<NewsPostInput, "authorDiscordId">,
) => NewsPost | null;
const setStatus = _setStatus as (id: number, status: NewsStatus) => NewsPost | null;
const remove = _delete as (id: number) => { changes: number };

export function getNewsPost(id: number): NewsPost | null {
  return getById(id);
}

export function getPublishedNewsPost(id: number, locale?: Locale): NewsPost | null {
  return getPublished(id, locale);
}

export function listAdminNewsPosts(filter?: {
  gameSlug?: string | null;
  status?: NewsStatus | null;
}): NewsPost[] {
  return listAdmin(filter || {});
}

export function listPublishedNewsPosts(gameSlug: string, locale: Locale): NewsPost[] {
  return listPublished({ gameSlug, locale });
}

export function listLatestPublishedNewsPosts(locale: Locale, limit = 4): NewsPost[] {
  return listLatest({ locale, limit });
}

export function createNewsPost(input: NewsPostInput): NewsPost {
  return create(input);
}

export function updateNewsPost(
  id: number,
  input: Omit<NewsPostInput, "authorDiscordId">,
): NewsPost | null {
  return update(id, input);
}

export function setNewsPostStatus(id: number, status: NewsStatus): NewsPost | null {
  return setStatus(id, status);
}

export function deleteNewsPost(id: number): { changes: number } {
  return remove(id);
}

// ---------------------------------------------------------------------------
// Cached public-read variants
// Tags: cms-news (and cms-games for reads that embed game data).
// Admin pages keep using the uncached functions above so drafts are visible.
// ---------------------------------------------------------------------------

export const getPublishedNewsPostCached = unstable_cache(
  async (id: number, locale?: Locale) => getPublishedNewsPost(id, locale),
  ["news-get-published"],
  { tags: ["cms-news", "cms-games"] },
);

export const listPublishedNewsPostsCached = unstable_cache(
  async (gameSlug: string, locale: Locale) => listPublishedNewsPosts(gameSlug, locale),
  ["news-list-published"],
  { tags: ["cms-news", "cms-games"] },
);

export const listLatestPublishedNewsPostsCached = unstable_cache(
  async (locale: Locale, limit = 4) => listLatestPublishedNewsPosts(locale, limit),
  ["news-list-latest"],
  { tags: ["cms-news", "cms-games"] },
);
