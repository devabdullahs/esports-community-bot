import "server-only";

import { all } from "@bot/db/client.js";
import { resolveCanonicalTournamentId as _resolveCanonicalTournamentId } from "@bot/db/tournaments.js";
import { resolveDefaultGuildId } from "@/lib/guild";

const resolveCanonicalTournamentId = _resolveCanonicalTournamentId as (id: number) => Promise<number>;

export type SeoEntityEntry = {
  id: number;
  updatedAt: string | null;
};

export type SeoLeaderboardEntry = {
  guildId: string;
  season: string;
  updatedAt: string | null;
};

export async function listIndexableTeams(): Promise<SeoEntityEntry[]> {
  const rows = await all(
    `SELECT t.id, t.updated_at
       FROM teams t
      WHERE TRIM(COALESCE(t.name, '')) <> ''
        AND (
          NULLIF(TRIM(COALESCE(t.image_url, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(t.location, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(t.nationality, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(t.liquipedia_url, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(t.liquipedia_facts, '')), '') IS NOT NULL
          OR EXISTS (SELECT 1 FROM players p WHERE p.current_team_id = t.id)
        )
      ORDER BY t.id`,
    [],
  ) as Array<{ id: number | string; updated_at?: string | null }>;
  return rows.map((row) => ({ id: Number(row.id), updatedAt: row.updated_at ?? null }));
}

export async function listIndexablePlayers(): Promise<SeoEntityEntry[]> {
  const rows = await all(
    `SELECT p.id, p.updated_at
       FROM players p
      WHERE TRIM(COALESCE(p.name, '')) <> ''
        AND (
          NULLIF(TRIM(COALESCE(p.image_url, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.nationality, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.first_name, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.last_name, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.current_team_name, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.role, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.liquipedia_url, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(p.liquipedia_facts, '')), '') IS NOT NULL
        )
      ORDER BY p.id`,
    [],
  ) as Array<{ id: number | string; updated_at?: string | null }>;
  return rows.map((row) => ({ id: Number(row.id), updatedAt: row.updated_at ?? null }));
}

export async function listIndexableMatches(): Promise<SeoEntityEntry[]> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  const rows = await all(
    `SELECT m.id,
            CASE
              WHEN md.updated_at IS NOT NULL AND md.updated_at > m.updated_at THEN md.updated_at
              ELSE m.updated_at
            END AS updated_at
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       JOIN match_details md ON md.match_id = m.id
      WHERE m.scheduled_at > 0
        AND t.active = 1
        AND t.guild_id = $1
        AND LOWER(TRIM(COALESCE(m.team_a, ''))) NOT IN ('', 'tbd', 'lobby', 'unknown', 'bye', '-')
        AND LOWER(TRIM(COALESCE(m.team_b, ''))) NOT IN ('', 'tbd', 'lobby', 'unknown', 'bye', '-')
      ORDER BY m.id`,
    [guildId],
  ) as Array<{ id: number | string; updated_at?: string | null }>;
  return rows.map((row) => ({ id: Number(row.id), updatedAt: row.updated_at ?? null }));
}

export async function listIndexableTournaments(): Promise<SeoEntityEntry[]> {
  const guildId = await resolveDefaultGuildId();
  if (!guildId) return [];
  type UpdatedRow = { tournament_id: number | string; updated_at?: string | null };
  const [rows, matchDates, detailDates, standingDates] = await Promise.all([
    all(
      `SELECT t.id, t.created_at AS updated_at
         FROM tournaments t
        WHERE TRIM(COALESCE(t.name, '')) <> ''
          AND t.active = 1
          AND t.guild_id = $1
        ORDER BY t.id`,
      [guildId],
    ) as Promise<Array<{ id: number | string; updated_at?: string | null }>>,
    all(
      `SELECT m.tournament_id, MAX(m.updated_at) AS updated_at
         FROM matches m JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.active = 1 AND t.guild_id = $1
        GROUP BY m.tournament_id`,
      [guildId],
    ) as Promise<UpdatedRow[]>,
    all(
      `SELECT m.tournament_id, MAX(md.updated_at) AS updated_at
         FROM match_details md
         JOIN matches m ON m.id = md.match_id
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE t.active = 1 AND t.guild_id = $1
        GROUP BY m.tournament_id`,
      [guildId],
    ) as Promise<UpdatedRow[]>,
    all(
      `SELECT ts.tournament_id, MAX(ts.updated_at) AS updated_at
         FROM tournament_standings ts
         JOIN tournaments t ON t.id = ts.tournament_id
        WHERE t.active = 1 AND t.guild_id = $1
        GROUP BY ts.tournament_id`,
      [guildId],
    ) as Promise<UpdatedRow[]>,
  ]);
  const updatedByTournament = new Map<number, string>();
  for (const row of [...matchDates, ...detailDates, ...standingDates]) {
    const id = Number(row.tournament_id);
    const updatedAt = row.updated_at || "";
    if (updatedAt > (updatedByTournament.get(id) || "")) updatedByTournament.set(id, updatedAt);
  }
  const canonical = await Promise.all(
    rows.map(async (row) => ({ row, canonicalId: await resolveCanonicalTournamentId(Number(row.id)) })),
  );
  return canonical
    .filter(({ row, canonicalId }) => Number(row.id) === canonicalId)
    .map(({ row }) => {
      const id = Number(row.id);
      const updatedAt = updatedByTournament.get(id);
      return { id, updatedAt: updatedAt && updatedAt > String(row.updated_at || "") ? updatedAt : row.updated_at ?? null };
    });
}

export async function listIndexableLeaderboards(): Promise<SeoLeaderboardEntry[]> {
  const rows = await all(
    `SELECT guild_id, season, MAX(updated_at) AS updated_at
       FROM (
         SELECT guild_id, season, COALESCE(scored_at, created_at) AS updated_at
           FROM ewc_prediction_seasons
         UNION ALL
         SELECT guild_id, season, COALESCE(scored_at, created_at) AS updated_at
           FROM ewc_prediction_weeks
       ) namespaces
      GROUP BY guild_id, season
      ORDER BY guild_id, season`,
    [],
  ) as Array<{
    guild_id: string | number;
    season: string | number;
    updated_at?: string | null;
  }>;
  return rows.map((row) => ({
    guildId: String(row.guild_id),
    season: String(row.season),
    updatedAt: row.updated_at ?? null,
  }));
}
