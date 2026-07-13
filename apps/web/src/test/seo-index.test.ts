import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get, run } from "@bot/db/client.js";
import { getMatchPageModel } from "@/lib/match-details";
import {
  listIndexableLeaderboards,
  listIndexableMatches,
  listIndexablePlayers,
  listIndexableTournaments,
} from "@/lib/seo-index";

const guildId = `seo-guild-${Date.now()}`;
const previousGuild = process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID;
let activeTournamentId = 0;
let inactiveTournamentId = 0;
let activeMatchId = 0;
let inactiveMatchId = 0;
let affiliatedPlayerId = 0;
const foreignGuildId = `${guildId}-foreign`;
const leaderboardSeason = `seo-${Date.now()}`;

beforeAll(async () => {
  process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = guildId;
  const active = await get(
    `INSERT INTO tournaments (source, external_id, game, name, guild_id, active, created_at)
     VALUES ('liquipedia', $1, 'valorant', 'SEO Active', $2, 1, '2026-07-01 00:00:00')
     RETURNING id`,
    [`seo-active-${Date.now()}`, guildId],
  ) as { id: number };
  const inactive = await get(
    `INSERT INTO tournaments (source, external_id, game, name, guild_id, active, created_at)
     VALUES ('liquipedia', $1, 'valorant', 'SEO Inactive', $2, 0, '2026-07-01 00:00:00')
     RETURNING id`,
    [`seo-inactive-${Date.now()}`, guildId],
  ) as { id: number };
  activeTournamentId = Number(active.id);
  inactiveTournamentId = Number(inactive.id);

  const activeMatch = await get(
    `INSERT INTO matches
       (tournament_id, source, external_id, team_a, team_b, status, scheduled_at, updated_at)
     VALUES ($1, 'liquipedia', $2, 'Alpha', 'Bravo', 'finished', 1783900800, '2026-07-02 00:00:00')
     RETURNING id`,
    [activeTournamentId, `seo-match-active-${Date.now()}`],
  ) as { id: number };
  const inactiveMatch = await get(
    `INSERT INTO matches
       (tournament_id, source, external_id, team_a, team_b, status, scheduled_at, updated_at)
     VALUES ($1, 'liquipedia', $2, 'Hidden A', 'Hidden B', 'finished', 1783900800, '2026-07-02 00:00:00')
     RETURNING id`,
    [inactiveTournamentId, `seo-match-inactive-${Date.now()}`],
  ) as { id: number };
  activeMatchId = Number(activeMatch.id);
  inactiveMatchId = Number(inactiveMatch.id);

  for (const matchId of [activeMatchId, inactiveMatchId]) {
    await run(
      `INSERT INTO match_details (match_id, source_page, game, payload_json, fetched_at, updated_at)
       VALUES ($1, 'fixture', 'valorant', $2, '2026-07-03 00:00:00', '2026-07-03 00:00:00')`,
      [matchId, JSON.stringify({ version: 1, kind: "valorant", maps: [] })],
    );
  }
  await run(
    `INSERT INTO tournament_standings
       (tournament_id, section, rank, team, points, updated_at)
     VALUES ($1, 'Final', 1, 'Alpha', '10', '2026-07-04 00:00:00')`,
    [activeTournamentId],
  );
  const team = await get(
    `INSERT INTO teams (game, name) VALUES ('valorant', $1) RETURNING id`,
    [`SEO Team ${Date.now()}`],
  ) as { id: number };
  const player = await get(
    `INSERT INTO players (game, name, current_team_id) VALUES ('valorant', $1, $2) RETURNING id`,
    [`SEO Player ${Date.now()}`, Number(team.id)],
  ) as { id: number };
  affiliatedPlayerId = Number(player.id);
  await run(
    `INSERT INTO ewc_prediction_seasons (guild_id, season, status)
     VALUES ($1, $2, 'open'), ($3, $2, 'open')`,
    [guildId, leaderboardSeason, foreignGuildId],
  );
});

afterAll(() => {
  if (previousGuild === undefined) delete process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID;
  else process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = previousGuild;
});

describe("SEO public inventory boundary", () => {
  it("excludes inactive tournaments and matches and uses detail/standings modification dates", async () => {
    const tournaments = await listIndexableTournaments();
    const matches = await listIndexableMatches();
    expect(tournaments).toContainEqual({ id: activeTournamentId, updatedAt: "2026-07-04 00:00:00" });
    expect(tournaments.some((row) => row.id === inactiveTournamentId)).toBe(false);
    expect(matches).toContainEqual({ id: activeMatchId, updatedAt: "2026-07-03 00:00:00" });
    expect(matches.some((row) => row.id === inactiveMatchId)).toBe(false);
  });

  it("does not serve a match belonging to an inactive tournament", async () => {
    expect(await getMatchPageModel(activeMatchId)).not.toBeNull();
    expect(await getMatchPageModel(inactiveMatchId)).toBeNull();
  });

  it("includes team-affiliated players and only the configured guild leaderboard", async () => {
    expect(await listIndexablePlayers()).toContainEqual(
      expect.objectContaining({ id: affiliatedPlayerId }),
    );
    const leaderboards = await listIndexableLeaderboards();
    expect(leaderboards).toContainEqual(
      expect.objectContaining({ guildId, season: leaderboardSeason }),
    );
    expect(leaderboards.some((row) => row.guildId === foreignGuildId)).toBe(false);
  });
});
