import "server-only";

import {
  createEwcGame as _create,
  deleteEwcGame as _delete,
  getEwcGame as _get,
  listEwcGames as _list,
  reorderEwcGames as _reorder,
  updateEwcGame as _update,
} from "@bot/db/ewcGames.js";
import { localizeText } from "@/lib/community-content";
import type { Locale } from "@/lib/i18n";
import { unstable_cache } from "next/cache";

export type LocalizedText = Record<Locale, string>;

export type GameRecord = {
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  status: LocalizedText;
  owner: LocalizedText;
  focus: LocalizedText[];
  discordChannelId: string | null;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type GameInput = {
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  status: LocalizedText;
  owner: LocalizedText;
  focus: LocalizedText[];
  discordChannelId: string | null;
};

const CANONICAL_GAME_TITLES: Partial<Record<string, LocalizedText>> = {
  fighters: {
    en: "Fighter Games",
    ar: "\u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u0642\u062a\u0627\u0644\u064a\u0629",
  },
};

const list = _list as () => Promise<GameRecord[]>;
const get = _get as (slug: string) => Promise<GameRecord | null>;
const create = _create as unknown as (input: GameInput) => Promise<GameRecord>;
const update = _update as unknown as (
  slug: string,
  input: Omit<GameInput, "slug">,
) => Promise<GameRecord | null>;
export type GameDeleteResult = {
  gameDeleted: number;
  postsDeleted: number;
  mediaPostsDetached: number;
  mediaChannelsDetached: number;
};

const remove = _delete as (slug: string) => Promise<GameDeleteResult>;
const reorder = _reorder as (slugs: string[]) => Promise<GameRecord[]>;

export function listGames(): Promise<GameRecord[]> {
  return list();
}

export function getGame(slug: string): Promise<GameRecord | null> {
  return get(slug);
}

export function createGame(input: GameInput): Promise<GameRecord> {
  return create(input);
}

export function updateGame(slug: string, input: Omit<GameInput, "slug">): Promise<GameRecord | null> {
  return update(slug, input);
}

export function deleteGame(slug: string): Promise<GameDeleteResult> {
  return remove(slug);
}

export function reorderGames(slugs: string[]): Promise<GameRecord[]> {
  return reorder(slugs);
}

export function fallbackGameTitle(slug: string | null | undefined, locale: Locale): string {
  const key = String(slug ?? "").trim();
  if (!key) return "";
  return CANONICAL_GAME_TITLES[key]?.[locale] ?? key;
}

export function gameTitleForSlug(
  slug: string | null | undefined,
  games: Pick<GameRecord, "slug" | "title">[],
  locale: Locale,
): string {
  const key = String(slug ?? "").trim();
  if (!key) return "";
  const game = games.find((g) => g.slug === key);
  const title = game ? localizeText(game.title, locale).trim() : "";
  return title || fallbackGameTitle(key, locale);
}

// ---------------------------------------------------------------------------
// Cached public-read variants (tags: cms-games)
// Admin pages must keep using the uncached functions above so they see
// drafts / edits instantly without waiting for tag invalidation.
// ---------------------------------------------------------------------------

// Fixed key, so the namespace is exactly one entry. Tag invalidation still busts it on an
// admin write; the finite window bounds how long a stale list can persist if a tag is missed.
export const listGamesCached = unstable_cache(
  async () => listGames(),
  ["games-list"],
  { tags: ["cms-games"], revalidate: 300 },
);

/**
 * Admitted lookup over the fixed-key list — NOT a per-slug cache.
 *
 * A per-slug `unstable_cache` created one persistent entry per requested slug, so anonymous
 * misses minted a namespace an attacker chose, and the `notFound()` that followed could not
 * retract it. The list already contains the complete records, so a miss now costs nothing.
 */
export async function getGameCached(slug: string): Promise<GameRecord | null> {
  const wanted = String(slug ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const games = await listGamesCached();
  return games.find((game) => game.slug.toLowerCase() === wanted) ?? null;
}
