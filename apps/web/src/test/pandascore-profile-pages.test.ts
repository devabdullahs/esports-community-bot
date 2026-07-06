import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { savePlayerLiquipedia, upsertPlayer } from "@bot/db/players.js";
import { saveTeamLiquipedia, upsertTeam } from "@bot/db/teams.js";

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
  await saveTeamLiquipedia(team.id, {
    url: "https://liquipedia.net/valorant/Team_Alpha",
    facts: {
      location: "South Korea",
      region: "Korea",
      coach: "Easyhoon",
      manager: "Becker",
      approx_total_winnings: "$10,067,532",
    },
    raw: `
      <div class="fo-nttax-infobox">
        <div><div class="infobox-header wiki-backgroundcolor-light infobox-header-2">Achievements</div></div>
        <div><div class="infobox-center">
          <span class="league-icon-small-image"><a href="/valorant/Event" title="Masters 2026"><img alt="Masters 2026" src="/commons/images/masters.png"></a></span>
        </div></div>
      </div>
    `,
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
  await savePlayerLiquipedia(player.id, {
    url: "https://liquipedia.net/valorant/Player_One",
    facts: {
      romanized_name: "Player Realname",
      status: "Active",
      team: "Team Alpha",
      approx_total_winnings: "$12,345",
    },
    raw: `
      <div class="fo-nttax-infobox">
        <div><div class="infobox-header wiki-backgroundcolor-light infobox-header-2">Achievements</div></div>
        <div><div class="infobox-center">
          <span class="league-icon-small-image"><a href="/valorant/Event" title="Champions 2026"><img alt="Champions 2026" src="/commons/images/champions.png"></a></span>
        </div></div>
        <div><div class="infobox-header wiki-backgroundcolor-light infobox-header-2">History</div></div>
        <div><div class="infobox-center"><table><tbody>
          <tr><td>2025-01-01 — Present</td><td><a href="/valorant/Team_Alpha">Team Alpha</a></td></tr>
        </tbody></table></div></div>
      </div>
    `,
  });

  const TeamPage = (await import("@/app/teams/[id]/page")).default;
  const PlayerPage = (await import("@/app/players/[id]/page")).default;

  const teamHtml = renderToStaticMarkup(
    await TeamPage({ params: Promise.resolve({ id: String(team.id) }) }),
  );
  expect(teamHtml).toContain("Team Alpha");
  expect(teamHtml).toContain("Player One");
  expect(teamHtml).toContain("Profile data from Liquipedia and PandaScore");
  expect(teamHtml).toContain("Team information");
  expect(teamHtml).toContain("$10,067,532");
  expect(teamHtml).toContain("Masters 2026");
  expect(teamHtml).toContain("object-top");

  const playerHtml = renderToStaticMarkup(
    await PlayerPage({ params: Promise.resolve({ id: String(player.id) }) }),
  );
  expect(playerHtml).toContain("Player One");
  expect(playerHtml).toContain("Team Alpha");
  expect(playerHtml).toContain("Active");
  expect(playerHtml).toContain("Profile data from Liquipedia and PandaScore");
  expect(playerHtml).toContain("Player Realname");
  expect(playerHtml).toContain("$12,345");
  expect(playerHtml).toContain("Champions 2026");
  expect(playerHtml).toContain("2025-01-01");
});
