import { describe, expect, test } from "vitest";
import {
  countUniqueQualifiedGames,
  getEwcClubTrackerFromDatabase,
  type EwcClubGame,
} from "@/lib/ewc-clubs";
import { clubKeys as clubKeysForTest } from "@/lib/ewc-club-regions";

function qualifiedGame(label: string, pageUrl: string | null = null): EwcClubGame {
  return {
    label,
    shortLabel: label,
    pageUrl,
    icon: null,
    status: "qualified",
    entries: [],
  };
}

describe("EWC club tracker helpers", () => {
  test("counts unique qualified games, not club-game slots", () => {
    const dota = qualifiedGame("Dota 2", "https://liquipedia.net/dota2/Esports_World_Cup/2026");

    expect(
      countUniqueQualifiedGames([
        { qualifiedGames: [dota] },
        { qualifiedGames: [dota, qualifiedGame("Chess", "https://liquipedia.net/chess/Esports_World_Cup/2026")] },
      ]),
    ).toBe(2);
  });

  test("dedupes by normalized label when a game page URL is missing", () => {
    expect(
      countUniqueQualifiedGames([
        { qualifiedGames: [qualifiedGame("Counter-Strike 2")] },
        { qualifiedGames: [qualifiedGame("counter strike 2")] },
      ]),
    ).toBe(1);
  });

  test("merges compact stored aliases into the official standings club", async () => {
    const { get, run } = await import("@bot/db/client.js");
    const { upsertEwcClubChampionshipSnapshot } = await import(
      "@bot/db/ewcClubChampionshipSnapshots.js"
    );
    await run(
      `INSERT OR IGNORE INTO ewc_games
         (slug, title_json, description_json, status_json, owner_json, focus_json, sort_order)
       VALUES ($1, $2, '{}', '{}', '{}', '[]', 0)`,
      ["alias-probe", JSON.stringify({ en: "Alias Probe", ar: "Alias Probe" })],
    );
    await run(
      `INSERT INTO tournaments (source, external_id, game, name, guild_id, ewc, active)
       VALUES ('liquipedia', $1, 'alias-probe', 'Alias Probe Event', 'guild', 1, 1)`,
      ["club-alias-probe"],
    );
    const tournament = await get(
      `SELECT id FROM tournaments WHERE source = 'liquipedia' AND external_id = $1`,
      ["club-alias-probe"],
    ) as { id: number };
    await run(
      `INSERT INTO tournament_standings (tournament_id, section, rank, team, points)
       VALUES ($1, 'Standings', 1, '100thieves', '12'),
              ($1, 'Standings', 2, 'natusvincere', '8')`,
      [tournament.id],
    );
    await upsertEwcClubChampionshipSnapshot({
      season: "2199",
      sourceUrl: "https://liquipedia.net/esports/Esports_World_Cup/2199/Club_Championship_Standings",
      standings: [
        { rank: 1, team: "100 Thieves", points: 1000, wins: 1 },
        { rank: 1, team: "Natus Vincere", points: 1000, wins: 1 },
      ],
      prizepool: [],
      fetchedAt: "2000-07-10T10:00:00.000Z",
    });

    const tracker = await getEwcClubTrackerFromDatabase("2199");

    expect(tracker.clubs.filter((club) => clubKeysForTest(club.name).includes("100thieves")))
      .toHaveLength(1);
    expect(tracker.clubs.filter((club) => clubKeysForTest(club.name).includes("natusvincere")))
      .toHaveLength(1);
    expect(tracker.clubs.map((club) => club.name)).toEqual(
      expect.arrayContaining(["100 Thieves", "Natus Vincere"]),
    );
  });

  test("database fallback returns local points and qualified games", async () => {
    const { get, run } = await import("@bot/db/client.js");
    const { upsertEwcClubChampionshipSnapshot } = await import(
      "@bot/db/ewcClubChampionshipSnapshots.js"
    );
    await run(
      `INSERT OR IGNORE INTO ewc_games
         (slug, title_json, description_json, status_json, owner_json, focus_json, sort_order)
       VALUES ($1, $2, '{}', '{}', '{}', '[]', 0)`,
      ["probe-game", JSON.stringify({ en: "Probe Game", ar: "Probe Game" })],
    );
    await run(
      `INSERT INTO tournaments (source, external_id, game, name, guild_id, ewc, active)
       VALUES ('liquipedia', $1, 'probe-game', 'Probe Event', 'guild', 1, 1)`,
      ["mcp-fallback-probe"],
    );
    const tournament = await get(
      `SELECT id FROM tournaments WHERE source = 'liquipedia' AND external_id = $1`,
      ["mcp-fallback-probe"],
    ) as { id: number };
    await run(
      `INSERT INTO tournament_standings (tournament_id, section, rank, team, points)
       VALUES ($1, 'Standings', 1, 'Probe Club', '12')`,
      [tournament.id],
    );
    await run(
      `INSERT INTO tournament_standings (tournament_id, section, rank, team, points)
       VALUES ($1, 'Standings', 2, 'Games Only Club', '8')`,
      [tournament.id],
    );
    await upsertEwcClubChampionshipSnapshot({
      season: "2026",
      sourceUrl: "https://liquipedia.net/esports/Esports_World_Cup/2026/Club_Championship_Standings",
      standings: [{ rank: 1, team: "Probe Club", points: 123 }],
      prizepool: [],
      fetchedAt: "2026-07-10T10:00:00.000Z",
    });
    await run(
      `INSERT INTO ewc_prediction_weeks
         (guild_id, season, week_key, label, status, results_json)
       VALUES ($1, '2026', $2, 'Probe Week', 'scored', $3)`,
      [
        "guild",
        "mcp-fallback-probe",
        JSON.stringify([
          {
            game: "Probe Game",
            placements: [{ club: "Probe Club", points: 1000 }],
          },
        ]),
      ],
    );

    const tracker = await getEwcClubTrackerFromDatabase();
    const club = tracker.clubs.find((entry) => entry.name === "Probe Club");
    const gamesOnlyClub = tracker.clubs.find((entry) => entry.name === "Games Only Club");

    expect(tracker.dataSource).toBe("stored-snapshot");
    expect(club).toMatchObject({
      points: 123,
      qualifiedGames: [expect.objectContaining({ shortLabel: "Probe Game" })],
      wins: [expect.objectContaining({ game: "Probe Game" })],
    });
    expect(gamesOnlyClub).toMatchObject({
      points: null,
      qualifiedGames: [expect.objectContaining({ shortLabel: "Probe Game" })],
    });
  });
});
