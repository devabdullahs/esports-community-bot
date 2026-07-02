import "server-only";

import {
  countTeams as _countTeams,
  listTeamGames as _listTeamGames,
  listTeams as _listTeams,
} from "@bot/db/teams.js";
import { countPlayers as _countPlayers, listPlayers as _listPlayers } from "@bot/db/players.js";
import type { PlayerProfile, TeamProfile } from "@/lib/pandascore-profiles";

// Typed boundary over the untyped bot modules (src/db/{teams,players}.js).
type DirectoryFilter = { game?: string | null; q?: string | null; limit?: number; offset?: number };

const listTeams = _listTeams as unknown as (filter?: DirectoryFilter) => Promise<TeamProfile[]>;
const countTeams = _countTeams as unknown as (filter?: { game?: string | null; q?: string | null }) => Promise<number>;
const listPlayers = _listPlayers as unknown as (filter?: DirectoryFilter) => Promise<PlayerProfile[]>;
const countPlayers = _countPlayers as unknown as (
  filter?: { game?: string | null; q?: string | null },
) => Promise<number>;

export const listTeamGames = _listTeamGames as unknown as () => Promise<string[]>;

const MAX_QUERY = 80;

export function cleanDirectoryQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim().slice(0, MAX_QUERY);
}

export function cleanGameSlug(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const slug = (raw ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(slug) ? slug : "";
}

export async function listTeamsDirectory(filter: DirectoryFilter) {
  const [teams, total] = await Promise.all([
    listTeams(filter),
    countTeams({ game: filter.game, q: filter.q }),
  ]);
  return { teams, total };
}

export async function listPlayersDirectory(filter: DirectoryFilter) {
  const [players, total] = await Promise.all([
    listPlayers(filter),
    countPlayers({ game: filter.game, q: filter.q }),
  ]);
  return { players, total };
}
