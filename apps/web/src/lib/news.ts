import "server-only";

// Importing the query module also runs src/db/index.js schema-init (it re-exports `db`
// from connection.js), so the ewc_news_posts table is created on first import.
// The bot's query module is plain JS with no type declarations, so we re-type the
// imported functions at this boundary to get full type-safety in the web app.
import {
  createEwcNewsPost as _create,
  createEwcNewsPostInTx as _createInTx,
  deleteEwcNewsPost as _delete,
  getEwcNewsPostById as _getById,
  getPublishedEwcNewsPost as _getPublished,
  listEwcNewsPostsForAdmin as _listAdmin,
  listLatestPublishedEwcNewsPosts as _listLatest,
  listPublishedEwcNewsPostsForDiscovery as _listForDiscovery,
  listPublishedEwcNewsPosts as _listPublished,
  listPublishedMediaPosts as _listMedia,
  searchPublishedEwcNewsPosts as _searchPublished,
  setEwcNewsPostStatus as _setStatus,
  updateEwcNewsPost as _update,
} from "@bot/db/ewcNewsPosts.js";
import type { Locale } from "@/lib/i18n";
import { unstable_cache } from "next/cache";

export type NewsStatus = "draft" | "scheduled" | "published";
export type NewsContentMode = "shared" | "translated";
export type NewsCoverPlacement = "top" | "bottom" | "card-only";

export type NewsTranslation = {
  locale: Locale;
  title: string;
  summary: string;
  body: string;
};

export type NewsAuthor = {
  discordId: string;
  name: string;
  avatarUrl: string | null;
};

export type NewsPost = {
  id: number;
  gameSlug: string | null;
  mediaSlug: string | null;
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
  ewc: boolean;
  translations: Partial<Record<Locale, NewsTranslation>>;
  authors: NewsAuthor[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
};

export type NewsPostInput = {
  gameSlug?: string | null;
  mediaSlug?: string | null;
  contentMode: NewsContentMode;
  defaultLocale: Locale;
  translations: Partial<Record<Locale, Omit<NewsTranslation, "locale">>>;
  status?: NewsStatus;
  scheduledPublishAt?: string | null;
  authorDiscordId?: string | null;
  authorName?: string | null;
  coverImageUrl?: string | null;
  coverPlacement?: NewsCoverPlacement;
  ewc?: boolean;
  authors?: NewsAuthor[];
};

const getById = _getById as (id: number) => Promise<NewsPost | null>;
const getPublished = _getPublished as (id: number, locale?: Locale) => Promise<NewsPost | null>;
const listAdmin = _listAdmin as (filter: {
  gameSlug?: string | null;
  mediaSlug?: string | null;
  status?: NewsStatus | null;
}) => Promise<NewsPost[]>;
const listPublished = _listPublished as (args: {
  gameSlug: string;
  locale: Locale;
}) => Promise<NewsPost[]>;
const listMedia = _listMedia as (args: {
  mediaSlug: string;
  locale: Locale;
  limit?: number;
}) => Promise<NewsPost[]>;
const listLatest = _listLatest as (args: {
  locale: Locale;
  limit?: number;
  ewcOnly?: boolean;
  offset?: number;
}) => Promise<NewsPost[]>;
const listForDiscovery = _listForDiscovery as () => Promise<NewsPost[]>;
const searchPublished = _searchPublished as (args: {
  query?: string;
  locale: Locale;
  gameSlug?: string | null;
  mediaSlug?: string | null;
  ewcOnly?: boolean;
  limit?: number;
  offset?: number;
}) => Promise<NewsPost[]>;
const create = _create as (input: NewsPostInput) => Promise<NewsPost>;
const createInTx = _createInTx as (tx: unknown, input: NewsPostInput) => Promise<number>;
const update = _update as (id: number, input: NewsPostInput) => Promise<NewsPost | null>;
const setStatus = _setStatus as (
  id: number,
  status: NewsStatus,
  scheduledPublishAt?: string | null,
) => Promise<NewsPost | null>;
const remove = _delete as (id: number) => Promise<{ changes: number }>;

export function getNewsPost(id: number): Promise<NewsPost | null> {
  return getById(id);
}

export function getPublishedNewsPost(id: number, locale?: Locale): Promise<NewsPost | null> {
  return getPublished(id, locale);
}

export function listAdminNewsPosts(filter?: {
  gameSlug?: string | null;
  mediaSlug?: string | null;
  status?: NewsStatus | null;
  locale?: Locale | null;
}): Promise<NewsPost[]> {
  return listAdmin(filter || {});
}

export function listPublishedNewsPosts(gameSlug: string, locale: Locale): Promise<NewsPost[]> {
  return listPublished({ gameSlug, locale });
}

export function listPublishedMediaPosts(mediaSlug: string, locale: Locale, limit = 50): Promise<NewsPost[]> {
  return listMedia({ mediaSlug, locale, limit });
}

export function listLatestPublishedNewsPosts(
  locale: Locale,
  limit = 4,
  ewcOnly = false,
  offset = 0,
): Promise<NewsPost[]> {
  return listLatest({ locale, limit, ewcOnly, offset });
}

export function listPublishedNewsPostsForDiscovery(): Promise<NewsPost[]> {
  return listForDiscovery();
}

export function searchPublishedNewsPosts(input: {
  query?: string;
  locale: Locale;
  gameSlug?: string | null;
  mediaSlug?: string | null;
  ewcOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<NewsPost[]> {
  return searchPublished(input);
}

export function createNewsPost(input: NewsPostInput): Promise<NewsPost> {
  return create(input);
}

export function createNewsPostInTx(tx: unknown, input: NewsPostInput): Promise<number> {
  return createInTx(tx, input);
}

export function updateNewsPost(id: number, input: NewsPostInput): Promise<NewsPost | null> {
  return update(id, input);
}

export function setNewsPostStatus(
  id: number,
  status: NewsStatus,
  scheduledPublishAt?: string | null,
): Promise<NewsPost | null> {
  return setStatus(id, status, scheduledPublishAt);
}

export function deleteNewsPost(id: number): Promise<{ changes: number }> {
  return remove(id);
}

// ---------------------------------------------------------------------------
// Cached public-read variants
// Tags: cms-news (and cms-games for reads that embed game data).
// Admin pages keep using the uncached functions above so drafts are visible.
// ---------------------------------------------------------------------------

// Cache-argument classes in this module. Every variable argument must be one of these, and a
// new cached read that does not fit belongs outside the persistent cache:
//   closed            - the two supported locales, or a boolean
//   admitted object   - an ID/slug proven to exist against a fixed-key inventory first
//   fixed purpose     - a named small read whose arguments are constants at the call site
//   high-cardinality  - free text and visitor-chosen pages; NOT persistently cached
//
// Syntax validity is not admission: `unstable_cache` keys on the argument tuple, so a
// well-formed but nonexistent slug or ID used to mint an entry that the `notFound()` after it
// could never retract.

export const listPublishedNewsPostsForDiscoveryCached = unstable_cache(
  async () => listPublishedNewsPostsForDiscovery(),
  ["news-list-published-discovery"],
  { tags: ["cms-news", "cms-games", "cms-media"], revalidate: 300 },
);

/**
 * Fixed-key inventory of published post IDs — the finite namespace detail reads admit against.
 *
 * Returns an array, never a `Set`: a cached value is JSON-serialized, so a `Set` survives the
 * cold call by identity and then comes back from a warm entry as `{}`. The admission check
 * would throw instead of failing closed, and only after the cache had been populated.
 */
const publishedNewsIdsCached = unstable_cache(
  async () => (await listPublishedNewsPostsForDiscovery()).map((post) => post.id),
  ["news-published-id-inventory"],
  { tags: ["cms-news", "cms-games", "cms-media"], revalidate: 300 },
);

// PRIVATE: only reachable once the ID has been admitted above.
const cachedPublishedNewsPost = unstable_cache(
  async (id: number, locale?: Locale) => getPublishedNewsPost(id, locale),
  ["news-get-published"],
  { tags: ["cms-news", "cms-games"], revalidate: 300 },
);

export async function getPublishedNewsPostCached(id: number, locale?: Locale) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const published = await publishedNewsIdsCached();
  if (!published.includes(id)) return null;
  return cachedPublishedNewsPost(id, locale);
}

const cachedPublishedNewsPostsForGame = unstable_cache(
  async (gameSlug: string, locale: Locale) => listPublishedNewsPosts(gameSlug, locale),
  ["news-list-published"],
  { tags: ["cms-news", "cms-games"], revalidate: 300 },
);

export async function listPublishedNewsPostsCached(gameSlug: string, locale: Locale) {
  const { listGamesCached } = await import("@/lib/games");
  const wanted = String(gameSlug ?? "").trim().toLowerCase();
  const games = await listGamesCached();
  const admitted = games.find((game) => game.slug.toLowerCase() === wanted);
  if (!admitted) return [];
  return cachedPublishedNewsPostsForGame(admitted.slug, locale);
}

const cachedPublishedMediaPosts = unstable_cache(
  async (mediaSlug: string, locale: Locale, limit: number) =>
    listPublishedMediaPosts(mediaSlug, locale, limit),
  ["media-posts-list-published"],
  { tags: ["cms-news", "cms-media"], revalidate: 300 },
);

export async function listPublishedMediaPostsCached(mediaSlug: string, locale: Locale, limit = 50) {
  const { listMediaChannelsCached } = await import("@/lib/media");
  const wanted = String(mediaSlug ?? "").trim().toLowerCase();
  const channels = await listMediaChannelsCached();
  const admitted = channels.find((channel) => channel.slug.toLowerCase() === wanted);
  if (!admitted) return [];
  return cachedPublishedMediaPosts(admitted.slug, locale, Math.min(200, Math.max(1, Math.trunc(limit))));
}

/**
 * The small fixed reads the homepage and games index make. Named for their purpose and given
 * constant arguments at the call site, rather than exporting one generic variable-args cache
 * that a visitor-paginated caller could reuse.
 */
export const listHomepageNewsPostsCached = unstable_cache(
  async (locale: Locale, limit: number) => listLatestPublishedNewsPosts(locale, limit, false, 0),
  ["news-list-homepage"],
  { tags: ["cms-news", "cms-games"], revalidate: 300 },
);

/**
 * Visitor-selected news pages are NOT persistently cached: `page` is unbounded, so each one
 * would mint its own entry for a nearly identical payload. The underlying query is already
 * bounded by limit/offset, so this reads through.
 */
export function listLatestPublishedNewsPosts_uncachedPage(
  locale: Locale,
  limit: number,
  ewcOnly: boolean,
  offset: number,
) {
  return listLatestPublishedNewsPosts(locale, limit, ewcOnly, offset);
}

/**
 * Free-text search is NOT persistently cached: the query is attacker-chosen and effectively
 * unbounded, so every distinct string would become its own cache namespace. Callers already
 * bound length, limit, and offset.
 */
export function searchPublishedNewsPostsUncached(
  query: string,
  locale: Locale,
  gameSlug: string,
  mediaSlug: string,
  ewcOnly: boolean,
  limit: number,
  offset: number,
) {
  return searchPublishedNewsPosts({
    query,
    locale,
    gameSlug: gameSlug || null,
    mediaSlug: mediaSlug || null,
    ewcOnly,
    limit,
    offset,
  });
}
