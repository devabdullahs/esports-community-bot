import "server-only";

import {
  getTeamById as _getTeamById,
  listTeamPlayers as _listTeamPlayers,
} from "@bot/db/teams.js";
import { getPlayerById as _getPlayerById } from "@bot/db/players.js";

export type TeamProfile = {
  id: number;
  game: string | null;
  pandascore_id: number | null;
  name: string;
  slug: string | null;
  acronym: string | null;
  nationality: string | null;
  image_url: string | null;
  location: string | null;
  modified_at: string | null;
  liquipedia_url: string | null;
  liquipedia_raw: string | null;
  liquipedia_facts: string | null;
  liquipedia_parsed_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlayerProfile = {
  id: number;
  game: string | null;
  pandascore_id: number | null;
  name: string;
  slug: string | null;
  first_name: string | null;
  last_name: string | null;
  nationality: string | null;
  image_url: string | null;
  role: string | null;
  current_team_id: number | null;
  current_team_pandascore_id: number | null;
  current_team_name: string | null;
  modified_at: string | null;
  liquipedia_url: string | null;
  liquipedia_raw: string | null;
  liquipedia_facts: string | null;
  liquipedia_parsed_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_team_id: number | null;
  resolved_team_name: string | null;
  resolved_team_slug: string | null;
  resolved_team_image_url: string | null;
};

const getTeamById = _getTeamById as (id: number) => Promise<TeamProfile | null>;
const listTeamPlayers = _listTeamPlayers as (id: number) => Promise<PlayerProfile[]>;
const getPlayerById = _getPlayerById as (id: number) => Promise<PlayerProfile | null>;

// Bot-side Liquipedia enrichment updates these rows outside of Next.js, so tag
// invalidation is not available when a profile gains fresh facts/images. Keep
// profile detail reads live; these pages are already dynamic and the DB lookups
// are cheap compared with showing stale enrichment for an hour.
export async function getTeamProfile(id: number) {
  return getTeamById(id);
}

export async function getTeamPlayers(id: number) {
  return listTeamPlayers(id);
}

export async function getPlayerProfile(id: number) {
  return getPlayerById(id);
}
