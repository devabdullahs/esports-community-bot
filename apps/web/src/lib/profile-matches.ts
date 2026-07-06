import "server-only";

import { all } from "@bot/db/client.js";
import { dedupeMatches as _dedupeMatches } from "@bot/db/matches.js";
import { normalizeTeamName as _normalizeTeamName } from "@bot/lib/render.js";
import { unstable_cache } from "next/cache";
import { resolveDefaultGuildId } from "@/lib/guild";
import { matchStream, type MatchRow, type MatchStream } from "@/lib/tournaments";

export type ProfileMatchRow = MatchRow & {
  external_id: string;
  source: string;
  game: string | null;
  tournament_id: number;
  tournament_name: string | null;
  tournament_url: string | null;
  tournament_source: string;
  tournament_path: string | null;
  stream: MatchStream | null;
};

export type ProfileMatches = {
  running: ProfileMatchRow[];
  scheduled: ProfileMatchRow[];
};

const normalizeTeamName = _normalizeTeamName as (value: string | null | undefined) => string;
const dedupeMatches = _dedupeMatches as <T extends ProfileMatchRow>(rows: T[]) => T[];

const PROFILE_MATCH_COLUMNS = `
  m.id, m.source, m.external_id, m.name, m.team_a, m.team_b, m.logo_a, m.logo_b,
  m.score_a, m.score_b, m.status, m.scheduled_at, m.stream_platform, m.stream_url, m.updated_at,
  t.id AS tournament_id, t.game AS game, t.name AS tournament_name, t.url AS tournament_url,
  t.source AS tournament_source, t.external_id AS tournament_path
`;

function emptyMatches(): ProfileMatches {
  return { running: [], scheduled: [] };
}

function targetKeys(names: Array<string | null | undefined>) {
  return new Set(names.map((name) => normalizeTeamName(name)).filter(Boolean));
}

function matchesTarget(name: string | null | undefined, keys: Set<string>) {
  const key = normalizeTeamName(name);
  return Boolean(key && keys.has(key));
}

function isLobbySchedule(row: ProfileMatchRow) {
  const teamB = String(row.team_b ?? "").trim();
  return !teamB || /^lobby$/i.test(teamB) || /^.+:br-schedule:/i.test(row.external_id);
}

function publicProfileMatch(row: ProfileMatchRow): ProfileMatchRow {
  return {
    id: row.id,
    source: row.source,
    external_id: row.external_id,
    game: row.game,
    name: row.name,
    team_a: row.team_a,
    team_b: row.team_b,
    logo_a: row.logo_a,
    logo_b: row.logo_b,
    score_a: row.score_a,
    score_b: row.score_b,
    status: row.status,
    scheduled_at: row.scheduled_at,
    updated_at: row.updated_at,
    tournament_id: row.tournament_id,
    tournament_name: row.tournament_name,
    tournament_url: row.tournament_url,
    tournament_source: row.tournament_source,
    tournament_path: row.tournament_path,
    stream: matchStream(row),
  };
}

function sortProfileMatches(a: ProfileMatchRow, b: ProfileMatchRow) {
  const status = (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1);
  if (status) return status;
  const aTime = a.scheduled_at ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.scheduled_at ?? Number.MAX_SAFE_INTEGER;
  return aTime - bTime || a.id - b.id;
}

export async function getProfileMatchesForTeamNames({
  game,
  names,
  limit = 6,
}: {
  game: string | null | undefined;
  names: Array<string | null | undefined>;
  limit?: number;
}): Promise<ProfileMatches> {
  const keys = targetKeys(names);
  if (!keys.size) return emptyMatches();

  const guildId = await resolveDefaultGuildId();
  if (!guildId) return emptyMatches();

  const params: unknown[] = [guildId];
  const gameFilter = game ? `AND t.game = $${params.push(game)}` : "";
  const [matchRows, standingRows] = await Promise.all([
    all(
      `SELECT ${PROFILE_MATCH_COLUMNS}
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.guild_id = $1 AND t.active = 1 AND t.archived_at IS NULL
          AND m.status IN ('running', 'scheduled')
          AND NOT (m.source = 'startgg' AND m.external_id LIKE 'sgg:preview_%')
          ${gameFilter}
        ORDER BY CASE m.status WHEN 'running' THEN 0 ELSE 1 END,
                 m.scheduled_at ASC,
                 m.id ASC`,
      params,
    ) as Promise<ProfileMatchRow[]>,
    all(
      `SELECT s.tournament_id, s.team
         FROM tournament_standings s
         JOIN tournaments t ON t.id = s.tournament_id
        WHERE t.guild_id = $1 AND t.active = 1 AND t.archived_at IS NULL
          ${gameFilter}`,
      params,
    ) as Promise<Array<{ tournament_id: number; team: string | null }>>,
  ]);

  const standingsTournamentIds = new Set(
    standingRows
      .filter((row) => matchesTarget(row.team, keys))
      .map((row) => row.tournament_id),
  );
  const filtered = matchRows
    .filter((row) => {
      if (matchesTarget(row.team_a, keys) || matchesTarget(row.team_b, keys)) return true;
      return standingsTournamentIds.has(row.tournament_id) && isLobbySchedule(row);
    })
    .map(publicProfileMatch)
    .sort(sortProfileMatches);
  const deduped = dedupeMatches(filtered);

  return {
    running: deduped.filter((row) => row.status === "running").slice(0, limit),
    scheduled: deduped.filter((row) => row.status === "scheduled").slice(0, limit),
  };
}

export const getProfileMatchesForTeamNamesCached = unstable_cache(
  async (args: { game: string | null | undefined; names: Array<string | null | undefined>; limit?: number }) =>
    getProfileMatchesForTeamNames(args),
  ["profile-matches-for-team-names"],
  { tags: ["cms-tournaments"], revalidate: 60 },
);
