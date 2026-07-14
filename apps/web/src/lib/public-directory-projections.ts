import "server-only";

import type { PlayerProfile, TeamProfile } from "@/lib/pandascore-profiles";

export type PublicDirectoryTeam = Pick<
  TeamProfile,
  "id" | "game" | "name" | "slug" | "acronym" | "nationality" | "location" | "image_url"
>;

export type PublicDirectoryPlayer = Pick<
  PlayerProfile,
  | "id"
  | "game"
  | "name"
  | "slug"
  | "first_name"
  | "last_name"
  | "nationality"
  | "image_url"
  | "role"
  | "current_team_name"
  | "resolved_team_id"
  | "resolved_team_name"
  | "resolved_team_slug"
  | "resolved_team_image_url"
>;

// Keep the directory's public field boundary in one place. Raw provider and
// enrichment columns never cross this projection.
export function publicDirectoryTeam(team: TeamProfile): PublicDirectoryTeam {
  return {
    id: team.id,
    game: team.game,
    name: team.name,
    slug: team.slug,
    acronym: team.acronym,
    nationality: team.nationality,
    location: team.location,
    image_url: team.image_url,
  };
}

export function publicDirectoryPlayer(player: PlayerProfile): PublicDirectoryPlayer {
  return {
    id: player.id,
    game: player.game,
    name: player.name,
    slug: player.slug,
    first_name: player.first_name,
    last_name: player.last_name,
    nationality: player.nationality,
    image_url: player.image_url,
    role: player.role,
    current_team_name: player.current_team_name,
    resolved_team_id: player.resolved_team_id,
    resolved_team_name: player.resolved_team_name,
    resolved_team_slug: player.resolved_team_slug,
    resolved_team_image_url: player.resolved_team_image_url,
  };
}
