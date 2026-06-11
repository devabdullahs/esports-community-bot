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

const list = _list as () => AdminRow[];
const get = _get as (discordId: string) => AdminRow | null;
const gameScopes = _gameScopes as (discordId: string) => string[];
const mediaScopes = _mediaScopes as (discordId: string) => string[];
const upsert = _upsert as (input: { discordId: string; displayName?: string }) => AdminRow;
const setGames = _setGames as (discordId: string, slugs: string[]) => void;
const setMedia = _setMedia as (discordId: string, slugs: string[]) => void;
const remove = _delete as (discordId: string) => { deleted: number };

export function listAdmins(): AdminRow[] {
  return list();
}
export function getAdmin(discordId: string): AdminRow | null {
  return get(discordId);
}
export function getAdminGameScopes(discordId: string): string[] {
  return gameScopes(discordId);
}
export function getAdminMediaScopes(discordId: string): string[] {
  return mediaScopes(discordId);
}
export function upsertAdmin(input: { discordId: string; displayName?: string }): AdminRow {
  return upsert(input);
}
export function setAdminGameScopes(discordId: string, slugs: string[]): void {
  setGames(discordId, slugs);
}
export function setAdminMediaScopes(discordId: string, slugs: string[]): void {
  setMedia(discordId, slugs);
}
export function deleteAdmin(discordId: string): { deleted: number } {
  return remove(discordId);
}
