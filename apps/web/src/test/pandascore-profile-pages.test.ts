import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { upsertPlayer } from "@bot/db/players.js";
import { upsertTeam } from "@bot/db/teams.js";

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => "en",
}));

test("team and player profile pages render synced PandaScore data", async () => {
  const team = await upsertTeam({
    game: "valorant",
    pandascore_id: 9001,
    name: "Team Alpha",
    slug: "team-alpha",
    acronym: "ALP",
    image_url: "https://img.example/team-alpha.png",
    raw_json: { id: 9001 },
  });
  const player = await upsertPlayer({
    game: "valorant",
    pandascore_id: 9002,
    name: "Player One",
    slug: "player-one",
    role: "duelist",
    image_url: "https://img.example/player-one.png",
    current_team_id: team.id,
    current_team_pandascore_id: 9001,
    current_team_name: "Team Alpha",
    raw_json: { id: 9002 },
  });

  const TeamPage = (await import("@/app/teams/[id]/page")).default;
  const PlayerPage = (await import("@/app/players/[id]/page")).default;

  const teamHtml = renderToStaticMarkup(
    await TeamPage({ params: Promise.resolve({ id: String(team.id) }) }),
  );
  expect(teamHtml).toContain("Team Alpha");
  expect(teamHtml).toContain("Player One");
  expect(teamHtml).toContain("Profile data from PandaScore");

  const playerHtml = renderToStaticMarkup(
    await PlayerPage({ params: Promise.resolve({ id: String(player.id) }) }),
  );
  expect(playerHtml).toContain("Player One");
  expect(playerHtml).toContain("Team Alpha");
  expect(playerHtml).toContain("duelist");
});
