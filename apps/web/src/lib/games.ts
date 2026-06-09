import "server-only";

import {
  createEwcGame as _create,
  deleteEwcGame as _delete,
  getEwcGame as _get,
  listEwcGames as _list,
  reorderEwcGames as _reorder,
  updateEwcGame as _update,
} from "@bot/db/ewcGames.js";
import type { Locale } from "@/lib/i18n";

export type LocalizedText = Record<Locale, string>;

export type GameRecord = {
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  status: LocalizedText;
  owner: LocalizedText;
  focus: LocalizedText[];
  sortOrder: number;
};

export type GameInput = {
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  status: LocalizedText;
  owner: LocalizedText;
  focus: LocalizedText[];
};

const list = _list as () => GameRecord[];
const get = _get as (slug: string) => GameRecord | null;
const create = _create as unknown as (input: GameInput) => GameRecord;
const update = _update as unknown as (
  slug: string,
  input: Omit<GameInput, "slug">,
) => GameRecord | null;
const remove = _delete as (slug: string) => { gameDeleted: number; postsDeleted: number };
const reorder = _reorder as (slugs: string[]) => GameRecord[];

export function listGames(): GameRecord[] {
  return list();
}

export function getGame(slug: string): GameRecord | null {
  return get(slug);
}

export function createGame(input: GameInput): GameRecord {
  return create(input);
}

export function updateGame(slug: string, input: Omit<GameInput, "slug">): GameRecord | null {
  return update(slug, input);
}

export function deleteGame(slug: string): { gameDeleted: number; postsDeleted: number } {
  return remove(slug);
}

export function reorderGames(slugs: string[]): GameRecord[] {
  return reorder(slugs);
}
