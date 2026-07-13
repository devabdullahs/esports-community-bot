type TeamLike = {
  name?: string | null;
  image_url?: string | null;
  location?: string | null;
  nationality?: string | null;
  liquipedia_url?: string | null;
  liquipedia_facts?: string | null;
};

type PlayerLike = {
  name?: string | null;
  image_url?: string | null;
  nationality?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  current_team_name?: string | null;
  current_team_id?: number | string | null;
  resolved_team_name?: string | null;
  role?: string | null;
  liquipedia_url?: string | null;
  liquipedia_facts?: string | null;
};

type MatchLike = {
  scheduled_at?: number | null;
  team_a?: string | null;
  team_b?: string | null;
  has_details?: boolean | number | string | null;
};

function present(value: unknown) {
  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

export function isIndexableTeam(team: TeamLike, hasRoster = false) {
  return present(team.name) && (
    hasRoster ||
    present(team.image_url) ||
    present(team.location) ||
    present(team.nationality) ||
    present(team.liquipedia_url) ||
    present(team.liquipedia_facts)
  );
}

export function isIndexablePlayer(player: PlayerLike) {
  return present(player.name) && [
    player.image_url,
    player.nationality,
    player.first_name,
    player.last_name,
    player.current_team_name,
    player.current_team_id,
    player.resolved_team_name,
    player.role,
    player.liquipedia_url,
    player.liquipedia_facts,
  ].some(present);
}

function realParticipant(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized) && !/^(?:tbd|lobby|unknown|bye|-+)$/i.test(normalized);
}

export function isIndexableMatch(match: MatchLike) {
  const details = match.has_details === true || match.has_details === 1 || match.has_details === "1";
  return details &&
    Number.isFinite(match.scheduled_at) &&
    Number(match.scheduled_at) > 0 &&
    realParticipant(match.team_a) &&
    realParticipant(match.team_b);
}
