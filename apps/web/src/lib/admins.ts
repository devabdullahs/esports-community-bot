import "server-only";

import {
  deleteEwcAdmin as _delete,
  getEwcAdmin as _get,
  getEwcAdminGameScopes as _gameScopes,
  getEwcAdminMediaScopes as _mediaScopes,
  listEwcAdmins as _list,
  setEwcAdminGameScopes as _setGames,
  setEwcAdminMediaScopes as _setMedia,
  upsertEwcAdmin as _upsert,
} from "@bot/db/ewcAdmins.js";

export type AdminRow = {
  discordId: string;
  displayName: string;
  createdAt: string;
  games: string[];
  media: string[];
};

const list = _list as () => Promise<AdminRow[]>;
const get = _get as (discordId: string) => Promise<AdminRow | null>;
const gameScopes = _gameScopes as (discordId: string) => Promise<string[]>;
const mediaScopes = _mediaScopes as (discordId: string) => Promise<string[]>;
const upsert = _upsert as (input: { discordId: string; displayName?: string }) => Promise<AdminRow>;
const setGames = _setGames as (discordId: string, slugs: string[]) => Promise<void>;
const setMedia = _setMedia as (discordId: string, slugs: string[]) => Promise<void>;
const remove = _delete as (discordId: string) => Promise<{ deleted: number }>;

export function listAdmins(): Promise<AdminRow[]> {
  return list();
}
export function getAdmin(discordId: string): Promise<AdminRow | null> {
  return get(discordId);
}
export function getAdminGameScopes(discordId: string): Promise<string[]> {
  return gameScopes(discordId);
}
export function getAdminMediaScopes(discordId: string): Promise<string[]> {
  return mediaScopes(discordId);
}
export function upsertAdmin(input: { discordId: string; displayName?: string }): Promise<AdminRow> {
  return upsert(input);
}
export function setAdminGameScopes(discordId: string, slugs: string[]): Promise<void> {
  return setGames(discordId, slugs);
}
export function setAdminMediaScopes(discordId: string, slugs: string[]): Promise<void> {
  return setMedia(discordId, slugs);
}
export function deleteAdmin(discordId: string): Promise<{ deleted: number }> {
  return remove(discordId);
}
