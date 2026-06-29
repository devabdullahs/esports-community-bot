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
const remove = _delete as (slug: string) => Promise<{ gameDeleted: number; postsDeleted: number }>;
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

export function deleteGame(slug: string): Promise<{ gameDeleted: number; postsDeleted: number }> {
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

export const listGamesCached = unstable_cache(
  async () => listGames(),
  ["games-list"],
  { tags: ["cms-games"] },
);

export const getGameCached = unstable_cache(
  async (slug: string) => getGame(slug),
  ["games-get"],
  { tags: ["cms-games"] },
);
